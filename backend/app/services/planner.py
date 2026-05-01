from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.schemas import (
    CandidateClip,
    CandidateScoreBreakdown,
    CandidateScoringResult,
    EditPlan,
    EditRange,
    PresetConfig,
    TranscriptArtifact,
    TranscriptSegment,
)
from app.services import llm

PLANNER_SYSTEM_PROMPT = """You are an expert YouTube media planning model.

Return exactly one JSON object that matches the provided schema.
Do not include markdown fences, commentary, or prose before or after the JSON.
Keep ranges must be sorted, non-overlapping, and within the source duration.
Prefer preserving good content rather than over-cutting.
The output will be executed by deterministic code, so the JSON must be precise."""

SHORTS_SCORING_SYSTEM_PROMPT = """You are an expert shorts candidate scorer for creator, AI, and technical content.

Return exactly one JSON object that matches the provided schema.
Do not include markdown fences, commentary, or prose before or after the JSON.
Score only the provided candidate IDs.
The output is planner-only metadata. Deterministic code will render clips from the provided timestamps."""

DEFAULT_SCORING_WEIGHTS = {
    "hook_strength": 1.25,
    "self_containedness": 1.1,
    "conflict_tension": 1.0,
    "payoff_clarity": 1.1,
    "novelty_interestingness": 1.0,
    "niche_relevance": 1.0,
    "verbosity_penalty": -0.8,
    "overlap_duplication_penalty": -0.7,
}


def _extract_json_blob(payload: str) -> str:
    start = payload.find("{")
    end = payload.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise RuntimeError("Planner response did not contain a JSON object.")
    return payload[start : end + 1]


def _transcript_lines(segments: list[TranscriptSegment]) -> str:
    return "\n".join(
        f"[{segment.start:0.2f}-{segment.end:0.2f}] {segment.text.strip()}"
        for segment in segments
        if segment.text.strip()
    )


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def _append_log(log_messages: list[str] | None, message: str) -> None:
    if log_messages is not None:
        log_messages.append(message)


def build_conservative_fallback_plan(
    *,
    source_file: str,
    preset: PresetConfig,
    source_duration: float,
    transcript_summary: str,
    captions_enabled: bool,
    keep_reason: str,
    note_for_user: str,
) -> EditPlan:
    if source_duration <= 0:
        raise RuntimeError("Cannot build a fallback plan for non-positive media duration.")

    duration = round(source_duration, 3)
    return EditPlan(
        source_file=source_file,
        preset=preset.name,
        transcript_summary=transcript_summary.strip(),
        keep_ranges=[
            EditRange(
                start=0.0,
                end=duration,
                reason=keep_reason,
            )
        ],
        cut_ranges=[],
        silence_removed_summary="",
        filler_removed_summary="",
        caption_strategy={
            "enabled": captions_enabled,
            "style": preset.caption_style,
        },
        subtitle_segments=[],
        zoom_events=[],
        shorts_candidates=[],
        notes_for_user=[note_for_user],
    )


def _complement_ranges(duration: float, keep_ranges: list[EditRange]) -> list[EditRange]:
    ranges: list[EditRange] = []
    cursor = 0.0
    for keep_range in keep_ranges:
        if keep_range.start - cursor >= 0.12:
            ranges.append(EditRange(start=round(cursor, 3), end=round(keep_range.start, 3), reason="cut"))
        cursor = keep_range.end
    if duration - cursor >= 0.12:
        ranges.append(EditRange(start=round(cursor, 3), end=round(duration, 3), reason="cut"))
    return ranges


def normalize_edit_plan(
    *,
    raw_plan: EditPlan,
    source_file: str,
    preset: PresetConfig,
    source_duration: float,
    source_mode: str,
    captions_enabled: bool,
    generate_shorts: bool,
) -> EditPlan:
    audio_only = source_mode == "audio-only"
    normalized_keep: list[EditRange] = []
    for item in sorted(raw_plan.keep_ranges, key=lambda segment: segment.start):
        start = round(_clamp(item.start, 0.0, source_duration), 3)
        end = round(_clamp(item.end, 0.0, source_duration), 3)
        if end - start < 0.12:
            continue
        if normalized_keep and start < normalized_keep[-1].end:
            start = normalized_keep[-1].end
        if end - start < 0.12:
            continue
        normalized_keep.append(EditRange(start=start, end=end, reason=item.reason))

    if not normalized_keep:
        raise RuntimeError("Planner returned no usable keep ranges.")

    cut_ranges = _complement_ranges(source_duration, normalized_keep)
    return EditPlan(
        source_file=source_file,
        preset=preset.name,
        transcript_summary=raw_plan.transcript_summary.strip(),
        keep_ranges=normalized_keep,
        cut_ranges=cut_ranges,
        silence_removed_summary=raw_plan.silence_removed_summary.strip(),
        filler_removed_summary=raw_plan.filler_removed_summary.strip(),
        caption_strategy={
            "enabled": (not audio_only) and captions_enabled and raw_plan.caption_strategy.enabled,
            "style": raw_plan.caption_strategy.style,
        },
        subtitle_segments=raw_plan.subtitle_segments,
        zoom_events=[] if audio_only else raw_plan.zoom_events,
        shorts_candidates=raw_plan.shorts_candidates if generate_shorts else [],
        notes_for_user=raw_plan.notes_for_user,
    )


def _sanitize_ranges(
    raw_ranges: Any,
    *,
    source_duration: float,
    range_label: str,
    default_reason: str,
    log_messages: list[str] | None,
) -> list[dict[str, Any]]:
    if not isinstance(raw_ranges, list):
        if raw_ranges is not None:
            _append_log(log_messages, f"Planner returned malformed {range_label}; ignoring it.")
        return []

    sanitized: list[dict[str, Any]] = []
    removed_count = 0
    for item in raw_ranges:
        if not isinstance(item, dict):
            removed_count += 1
            continue
        try:
            start = round(_clamp(float(item.get("start")), 0.0, source_duration), 3)
            end = round(_clamp(float(item.get("end")), 0.0, source_duration), 3)
        except (TypeError, ValueError):
            removed_count += 1
            continue
        if end <= start:
            removed_count += 1
            continue
        sanitized.append(
            {
                "start": start,
                "end": end,
                "reason": str(item.get("reason") or default_reason),
            }
        )

    if removed_count:
        _append_log(
            log_messages,
            f"Removed {removed_count} malformed planner {range_label} where end <= start or timestamps were invalid.",
        )
    return sanitized


def _sanitize_plan_payload(
    *,
    payload: dict[str, Any],
    source_file: str,
    preset: PresetConfig,
    source_duration: float,
    captions_enabled: bool,
    log_messages: list[str] | None,
) -> dict[str, Any]:
    sanitized = dict(payload)
    sanitized.setdefault("source_file", source_file)
    sanitized.setdefault("preset", preset.name)
    sanitized.setdefault("transcript_summary", "")
    sanitized.setdefault(
        "caption_strategy",
        {
            "enabled": captions_enabled,
            "style": preset.caption_style,
        },
    )
    sanitized["keep_ranges"] = _sanitize_ranges(
        sanitized.get("keep_ranges"),
        source_duration=source_duration,
        range_label="keep_ranges",
        default_reason="keep",
        log_messages=log_messages,
    )
    sanitized["cut_ranges"] = _sanitize_ranges(
        sanitized.get("cut_ranges"),
        source_duration=source_duration,
        range_label="cut_ranges",
        default_reason="cut",
        log_messages=log_messages,
    )
    return sanitized


def create_edit_plan(
    *,
    settings: Settings,
    llm_base_url: str,
    llm_model: str,
    source_filename: str,
    source_duration: float,
    preset: PresetConfig,
    transcript: TranscriptArtifact,
    source_mode: str,
    aggressiveness: str,
    captions_enabled: bool,
    generate_shorts: bool,
    user_notes: str | None,
    log_messages: list[str] | None = None,
) -> EditPlan:
    if not transcript.segments:
        _append_log(log_messages, "Zero-transcript fallback engaged. Skipping planner generation and using a conservative full-keep plan.")
        return build_conservative_fallback_plan(
            source_file=source_filename,
            preset=preset,
            source_duration=source_duration,
            transcript_summary="No speech detected in source audio.",
            captions_enabled=False,
            keep_reason="No speech detected; preserved full clip",
            note_for_user="No speech was detected in the source audio. Generated a conservative no-cut plan.",
        )

    schema = json.dumps(EditPlan.model_json_schema(), indent=2)
    prompt = f"""Create a structured keep-range plan for one source file.

Source file: {source_filename}
Source duration (seconds): {source_duration}
Source mode: {source_mode}
Preset:
{json.dumps(preset.model_dump(), indent=2)}

User settings:
- aggressiveness: {aggressiveness}
- captions enabled: {str(captions_enabled).lower()}
- generate shorts candidates: {str(generate_shorts).lower()}
- user notes: {user_notes or "none"}

Transcript segments:
{_transcript_lines(transcript.segments)}

Requirements:
- Keep the most valuable sections.
- Preserve hooks and CTAs when relevant.
- Prefer a premium YouTube pacing, not hyperactive jump cuts.
- Keep ranges must be chronological and non-overlapping.
- Use source timestamps, not output timestamps.
- If source mode is audio-only, do not emit zoom events and keep caption_strategy.enabled false.
- If unsure, preserve more than you cut.

JSON schema:
{schema}
"""

    response_text = llm.request_planner_completion(
        base_url=llm_base_url,
        model=llm_model,
        system_prompt=PLANNER_SYSTEM_PROMPT,
        user_prompt=prompt,
        timeout_seconds=settings.llm_request_timeout_seconds,
    )
    raw_payload = json.loads(_extract_json_blob(response_text))
    sanitized_payload = _sanitize_plan_payload(
        payload=raw_payload,
        source_file=source_filename,
        preset=preset,
        source_duration=source_duration,
        captions_enabled=captions_enabled,
        log_messages=log_messages,
    )
    if not sanitized_payload["keep_ranges"]:
        _append_log(
            log_messages,
            "Planner returned no usable keep ranges after sanitization; using a conservative full-keep fallback plan.",
        )
        return build_conservative_fallback_plan(
            source_file=source_filename,
            preset=preset,
            source_duration=source_duration,
            transcript_summary=str(sanitized_payload.get("transcript_summary") or "").strip(),
            captions_enabled=captions_enabled and source_mode != "audio-only",
            keep_reason="Planner fallback; preserved full clip",
            note_for_user="Planner output was malformed after sanitization. Generated a conservative no-cut plan.",
        )

    raw_plan = EditPlan.model_validate(sanitized_payload)
    try:
        return normalize_edit_plan(
            raw_plan=raw_plan,
            source_file=source_filename,
            preset=preset,
            source_duration=source_duration,
            source_mode=source_mode,
            captions_enabled=captions_enabled,
            generate_shorts=generate_shorts,
        )
    except RuntimeError:
        _append_log(
            log_messages,
            "Planner returned no usable keep ranges after normalization; using a conservative full-keep fallback plan.",
        )
        return build_conservative_fallback_plan(
            source_file=source_filename,
            preset=preset,
            source_duration=source_duration,
            transcript_summary=raw_plan.transcript_summary.strip(),
            captions_enabled=captions_enabled and source_mode != "audio-only",
            keep_reason="Planner fallback; preserved full clip",
            note_for_user="Planner output was malformed after sanitization. Generated a conservative no-cut plan.",
        )


def _candidate_lines(candidates: list[CandidateClip]) -> str:
    blocks = []
    for candidate in candidates:
        blocks.append(
            "\n".join(
                [
                    f"ID: {candidate.id}",
                    f"Time: {candidate.start_sec:0.2f}-{candidate.end_sec:0.2f}",
                    f"Duration: {candidate.end_sec - candidate.start_sec:0.2f}s",
                    f"Transcript excerpt: {candidate.transcript_excerpt}",
                ]
            )
        )
    return "\n\n".join(blocks)


def _fallback_breakdown() -> CandidateScoreBreakdown:
    return CandidateScoreBreakdown(
        hook_strength=0,
        self_containedness=0,
        conflict_tension=0,
        payoff_clarity=0,
        novelty_interestingness=0,
        niche_relevance=0,
        verbosity_penalty=10,
        overlap_duplication_penalty=0,
    )


def normalize_scored_candidates(
    *,
    candidates: list[CandidateClip],
    scoring_result: CandidateScoringResult,
    log_messages: list[str] | None = None,
) -> list[CandidateClip]:
    scores_by_id = {item.id: item for item in scoring_result.candidates}
    normalized: list[CandidateClip] = []
    missing_count = 0

    for candidate in candidates:
        score = scores_by_id.get(candidate.id)
        if score is None:
            missing_count += 1
            normalized.append(
                candidate.model_copy(
                    update={
                        "title": candidate.title or candidate.id,
                        "rationale": "Planner did not return a score for this pre-segmented candidate.",
                        "score_total": 0,
                        "score_breakdown": _fallback_breakdown(),
                    }
                )
            )
            continue

        normalized.append(
            candidate.model_copy(
                update={
                    "title": score.title.strip(),
                    "hook_text": score.hook_text.strip(),
                    "rationale": score.rationale.strip(),
                    "score_total": round(score.score_total, 2),
                    "score_breakdown": score.score_breakdown,
                    "tags": [tag.strip() for tag in score.tags if tag.strip()][:8],
                    "duplicate_group": score.duplicate_group,
                }
            )
        )

    unknown_count = len([item for item in scoring_result.candidates if item.id not in {candidate.id for candidate in candidates}])
    if missing_count:
        _append_log(log_messages, f"Planner omitted {missing_count} candidate scores; kept them with score 0.")
    if unknown_count:
        _append_log(log_messages, f"Ignored {unknown_count} planner scores for unknown candidate IDs.")

    return sorted(normalized, key=lambda item: item.score_total, reverse=True)


def score_short_candidates(
    *,
    settings: Settings,
    llm_base_url: str,
    llm_model: str,
    source_filename: str,
    source_duration: float,
    preset: PresetConfig,
    candidates: list[CandidateClip],
    user_notes: str | None,
    log_messages: list[str] | None = None,
) -> list[CandidateClip]:
    if not candidates:
        return []

    schema = json.dumps(CandidateScoringResult.model_json_schema(), indent=2)
    weights = {**DEFAULT_SCORING_WEIGHTS, **preset.scoring_weights}
    prompt = f"""Score and rank pre-segmented shorts candidates for one long-form source video.

Source file: {source_filename}
Source duration (seconds): {source_duration}

Preset:
{json.dumps(preset.model_dump(), indent=2)}

Scoring weights:
{json.dumps(weights, indent=2)}

User notes:
{user_notes or "none"}

Candidates:
{_candidate_lines(candidates)}

For each candidate, evaluate:
- hook strength in the opening seconds
- self-containedness
- conflict/tension
- payoff clarity
- novelty / interestingness
- niche relevance for creator/AI/technical content
- verbosity penalty / rambling penalty
- overlap / duplication penalty

Return one score item for each provided candidate ID. Use score_total from 0 to 100.
Penalty fields are 0 to 10 where higher means more penalty.
Prefer concise, specific suggested titles and hooks that match the transcript.

JSON schema:
{schema}
"""

    response_text = llm.request_planner_completion(
        base_url=llm_base_url,
        model=llm_model,
        system_prompt=SHORTS_SCORING_SYSTEM_PROMPT,
        user_prompt=prompt,
        timeout_seconds=settings.llm_request_timeout_seconds,
    )
    raw_payload = json.loads(_extract_json_blob(response_text))
    scoring_result = CandidateScoringResult.model_validate(raw_payload)
    scored_candidates = normalize_scored_candidates(
        candidates=candidates,
        scoring_result=scoring_result,
        log_messages=log_messages,
    )
    _append_log(log_messages, f"Planner scored {len(scored_candidates)} shorts candidates.")
    return scored_candidates
