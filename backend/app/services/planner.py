from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any

from app.config import Settings
from app.schemas import (
    CandidateBatchScoringResult,
    CandidateClip,
    CandidateEnrichmentResult,
    CandidateScoreBreakdown,
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

Return exactly one JSON object.
Do not include markdown fences, commentary, or prose before or after the JSON.
Score only the provided candidate IDs.
Focus on ranking quality first. Do not spend tokens writing titles or rationales.
The output is planner-only metadata. Deterministic code will render clips from the provided timestamps."""

SHORTS_ENRICHMENT_SYSTEM_PROMPT = """You are an expert shorts candidate packaging model for creator, AI, and technical content.

Return exactly one JSON object.
Do not include markdown fences, commentary, or prose before or after the JSON.
Generate title, hook_text, and rationale only for the provided candidate IDs.
Keep the writing specific to the transcript and avoid generic hype."""

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

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
WORD_RE = re.compile(r"[a-z0-9']+")
EMPHASIS_TERMS = {
    "actually",
    "because",
    "broken",
    "change",
    "changed",
    "debug",
    "failed",
    "fix",
    "problem",
    "result",
    "surprising",
    "turns out",
    "why",
    "wrong",
}
CONFLICT_TERMS = {"blocked", "bug", "challenge", "conflict", "error", "failed", "issue", "problem", "stuck", "wrong"}
PAYOFF_TERMS = {"fixed", "improved", "result", "solved", "therefore", "works", "working"}
INTEREST_TERMS = {"actually", "surprising", "unexpected", "wild", "turns out", "instead", "but", "however"}
TECHNICAL_TERMS = {
    "ai",
    "api",
    "automation",
    "docker",
    "endpoint",
    "ffmpeg",
    "json",
    "latency",
    "local",
    "model",
    "ollama",
    "planner",
    "prompt",
    "python",
    "qwen",
    "quantization",
    "runtime",
    "schema",
    "token",
    "workflow",
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


def _write_text_artifact(path: Path, content: str) -> None:
    path.write_text(content)


def _write_planner_prompt_artifact(artifact_dir: Path | None, *, system_prompt: str, user_prompt: str) -> None:
    if artifact_dir is None:
        return
    _write_text_artifact(
        artifact_dir / "planner-prompt.txt",
        f"System prompt:\n{system_prompt.strip()}\n\nUser prompt:\n{user_prompt.strip()}\n",
    )


def _write_planner_response_artifact(
    artifact_dir: Path | None,
    *,
    response_text: str,
    parsed_payload: dict[str, Any] | None,
) -> None:
    if artifact_dir is None:
        return
    if parsed_payload is not None:
        (artifact_dir / "planner-response.json").write_text(json.dumps(parsed_payload, indent=2))
        response_text_path = artifact_dir / "planner-response.txt"
        if response_text_path.exists():
            response_text_path.unlink(missing_ok=True)
        return
    _write_text_artifact(artifact_dir / "planner-response.txt", response_text)


@dataclass
class PlannerTraceEvent:
    stage: str
    event: str
    message: str
    severity: str = "info"
    payload: dict[str, Any] | None = None


@dataclass
class CandidateScoringOutcome:
    candidates: list[CandidateClip]
    degraded: bool = False
    notes_for_user: list[str] = field(default_factory=list)
    trace_events: list[PlannerTraceEvent] = field(default_factory=list)


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
    artifact_dir: Path | None = None,
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

    _write_planner_prompt_artifact(
        artifact_dir,
        system_prompt=PLANNER_SYSTEM_PROMPT,
        user_prompt=prompt,
    )
    response_text = llm.request_planner_completion(
        base_url=llm_base_url,
        model=llm_model,
        system_prompt=PLANNER_SYSTEM_PROMPT,
        user_prompt=prompt,
        timeout_seconds=settings.llm_request_timeout_seconds,
    )
    try:
        raw_payload = json.loads(_extract_json_blob(response_text))
    except Exception:
        _write_planner_response_artifact(artifact_dir, response_text=response_text, parsed_payload=None)
        raise
    _write_planner_response_artifact(artifact_dir, response_text=response_text, parsed_payload=raw_payload)
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


def _planner_setting_int(settings: Settings, name: str, default: int) -> int:
    try:
        return max(1, int(getattr(settings, name, default)))
    except (TypeError, ValueError):
        return default


def _source_text(candidate: CandidateClip) -> str:
    subtitle_text = " ".join(segment.text.strip() for segment in candidate.subtitle_segments if segment.text.strip())
    text = subtitle_text or candidate.transcript_excerpt
    return re.sub(r"\s+", " ", text).strip()


def _split_sentences(text: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    sentences = [sentence.strip() for sentence in SENTENCE_SPLIT_RE.split(clean) if sentence.strip()]
    return sentences or [clean]


def _truncate_text(text: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= limit:
        return clean
    truncated = clean[: max(0, limit - 3)].rsplit(" ", 1)[0].strip()
    return f"{truncated or clean[: max(0, limit - 3)].strip()}..."


def _keyword_hits(text: str, terms: set[str]) -> int:
    lowered = text.lower()
    return sum(1 for term in terms if term in lowered)


def _sentence_strength(sentence: str) -> tuple[int, int, int]:
    word_count = len(WORD_RE.findall(sentence.lower()))
    emphasis_hits = _keyword_hits(sentence, EMPHASIS_TERMS)
    punctuation_bonus = int("?" in sentence or "!" in sentence)
    return (emphasis_hits, punctuation_bonus, min(word_count, 24))


def _compact_candidate_excerpt(candidate: CandidateClip, max_chars: int) -> str:
    sentences = _split_sentences(_source_text(candidate))
    if not sentences:
        return ""
    if len(sentences) == 1:
        return _truncate_text(sentences[0], max_chars)

    selected_indexes = {0}
    ranked_indexes = sorted(range(1, len(sentences)), key=lambda index: _sentence_strength(sentences[index]), reverse=True)
    for index in ranked_indexes:
        if len(selected_indexes) >= 3:
            break
        tentative = " ".join(sentences[item] for item in sorted(selected_indexes | {index}))
        if len(tentative) <= max_chars:
            selected_indexes.add(index)

    if len(selected_indexes) == 1:
        for index in range(1, len(sentences)):
            tentative = " ".join(sentences[item] for item in sorted(selected_indexes | {index}))
            if len(tentative) <= max_chars:
                selected_indexes.add(index)
                break

    excerpt = " ".join(sentences[index] for index in sorted(selected_indexes))
    return _truncate_text(excerpt, max_chars)


def _planner_preset_summary(preset: PresetConfig) -> dict[str, Any]:
    return {
        "preset": preset.name,
        "description": preset.description,
        "planner_hint": preset.planner_hint,
        "target_clip_min_sec": preset.target_clip_min_sec,
        "target_clip_ideal_sec": preset.target_clip_ideal_sec,
        "target_clip_max_sec": preset.target_clip_max_sec,
    }


def _scoring_contract_text() -> str:
    return json.dumps(
        {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 84,
                    "score_breakdown": {
                        "hook_strength": 8,
                        "self_containedness": 8,
                        "conflict_tension": 6,
                        "payoff_clarity": 8,
                        "novelty_interestingness": 7,
                        "niche_relevance": 9,
                        "verbosity_penalty": 2,
                        "overlap_duplication_penalty": 1,
                    },
                    "tags": ["local-ai", "debugging"],
                    "duplicate_group": None,
                }
            ]
        },
        indent=2,
    )


def _enrichment_contract_text() -> str:
    return json.dumps(
        {
            "candidates": [
                {
                    "id": "clip-001",
                    "title": "The Quantization Fix",
                    "hook_text": "One setting made the local workflow work.",
                    "rationale": "Clear technical payoff, contained setup, and strong creator relevance.",
                }
            ]
        },
        indent=2,
    )


def _candidate_scoring_lines(
    candidates: list[CandidateClip],
    *,
    excerpt_char_limit: int,
) -> tuple[str, list[int]]:
    blocks: list[str] = []
    excerpt_lengths: list[int] = []
    for candidate in candidates:
        excerpt = _compact_candidate_excerpt(candidate, excerpt_char_limit)
        excerpt_lengths.append(len(excerpt))
        blocks.append(
            "\n".join(
                [
                    f"ID: {candidate.id}",
                    f"Time: {candidate.start_sec:0.2f}-{candidate.end_sec:0.2f}",
                    f"Duration: {candidate.end_sec - candidate.start_sec:0.2f}s",
                    f"Transcript excerpt: {excerpt or 'none'}",
                ]
            )
        )
    return "\n\n".join(blocks), excerpt_lengths


def _candidate_enrichment_lines(
    candidates: list[CandidateClip],
    *,
    excerpt_char_limit: int,
) -> tuple[str, list[int]]:
    blocks: list[str] = []
    excerpt_lengths: list[int] = []
    for candidate in candidates:
        excerpt = _compact_candidate_excerpt(candidate, excerpt_char_limit)
        excerpt_lengths.append(len(excerpt))
        breakdown = candidate.score_breakdown or _fallback_breakdown()
        blocks.append(
            "\n".join(
                [
                    f"ID: {candidate.id}",
                    f"Score: {candidate.score_total:0.2f}",
                    (
                        "Strong signals: "
                        f"hook {breakdown.hook_strength:0.1f}, "
                        f"self-contained {breakdown.self_containedness:0.1f}, "
                        f"payoff {breakdown.payoff_clarity:0.1f}"
                    ),
                    f"Tags: {', '.join(candidate.tags) if candidate.tags else 'none'}",
                    f"Transcript excerpt: {excerpt or 'none'}",
                ]
            )
        )
    return "\n\n".join(blocks), excerpt_lengths


def _build_scoring_prompt(
    *,
    source_filename: str,
    source_duration: float,
    preset: PresetConfig,
    weights: dict[str, float],
    user_notes: str | None,
    candidates: list[CandidateClip],
    excerpt_char_limit: int,
) -> tuple[str, list[int]]:
    candidate_lines, excerpt_lengths = _candidate_scoring_lines(candidates, excerpt_char_limit=excerpt_char_limit)
    prompt = f"""Score and rank pre-segmented shorts candidates for one long-form source video.

Source file: {source_filename}
Source duration (seconds): {source_duration}

Preset summary:
{json.dumps(_planner_preset_summary(preset), indent=2)}

Scoring weights:
{json.dumps(weights, indent=2)}

User notes:
{user_notes or "none"}

Candidates:
{candidate_lines}

Evaluate each candidate for:
- hook strength in the opening seconds
- self-containedness
- conflict/tension
- payoff clarity
- novelty / interestingness
- niche relevance for creator/AI/technical content
- verbosity penalty / rambling penalty
- overlap / duplication penalty

Rules:
- Return one score item for each provided candidate ID and no others.
- Use score_total from 0 to 100.
- Penalty fields are 0 to 10 where higher means more penalty.
- Keep tags short and specific.
- Set duplicate_group to null when there is no clear duplicate cluster.

Return exactly this JSON shape:
{_scoring_contract_text()}
"""
    return prompt, excerpt_lengths


def _build_enrichment_prompt(
    *,
    source_filename: str,
    source_duration: float,
    preset: PresetConfig,
    user_notes: str | None,
    candidates: list[CandidateClip],
    excerpt_char_limit: int,
) -> tuple[str, list[int]]:
    candidate_lines, excerpt_lengths = _candidate_enrichment_lines(candidates, excerpt_char_limit=excerpt_char_limit)
    prompt = f"""Enrich only the top ranked shorts candidates for one long-form source video.

Source file: {source_filename}
Source duration (seconds): {source_duration}

Preset summary:
{json.dumps(_planner_preset_summary(preset), indent=2)}

User notes:
{user_notes or "none"}

Top candidates:
{candidate_lines}

Rules:
- Return one enrichment item for each provided candidate ID and no others.
- Title should be concise, specific, and match the transcript.
- hook_text should feel like the first compelling line on the candidate card.
- rationale should explain why the clip works in one or two short sentences.

Return exactly this JSON shape:
{_enrichment_contract_text()}
"""
    return prompt, excerpt_lengths


def _append_prompt_section(
    prompt_sections: list[str],
    *,
    label: str,
    system_prompt: str,
    user_prompt: str,
) -> None:
    prompt_sections.append(
        f"{label}\nSystem prompt:\n{system_prompt.strip()}\n\nUser prompt:\n{user_prompt.strip()}\n"
    )


def _write_scoring_artifacts(
    artifact_dir: Path | None,
    *,
    prompt_sections: list[str],
    response_payload: dict[str, Any],
) -> None:
    if artifact_dir is None:
        return
    _write_text_artifact(artifact_dir / "planner-prompt.txt", "\n\n".join(prompt_sections).strip() + "\n")
    (artifact_dir / "planner-response.json").write_text(json.dumps(response_payload, indent=2))
    response_text_path = artifact_dir / "planner-response.txt"
    if response_text_path.exists():
        response_text_path.unlink(missing_ok=True)


def _batched(candidates: list[CandidateClip], size: int) -> list[list[CandidateClip]]:
    return [candidates[index : index + size] for index in range(0, len(candidates), size)]


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


def _time_overlap_ratio(left: CandidateClip, right: CandidateClip) -> float:
    overlap = max(0.0, min(left.end_sec, right.end_sec) - max(left.start_sec, right.start_sec))
    shorter = min(left.end_sec - left.start_sec, right.end_sec - right.start_sec)
    if shorter <= 0:
        return 0.0
    return overlap / shorter


def _word_jaccard(left: str, right: str) -> float:
    left_words = {word for word in WORD_RE.findall(left.lower()) if len(word) > 2}
    right_words = {word for word in WORD_RE.findall(right.lower()) if len(word) > 2}
    if not left_words or not right_words:
        return 0.0
    return len(left_words & right_words) / len(left_words | right_words)


def _heuristic_breakdown(
    candidate: CandidateClip,
    *,
    all_candidates: list[CandidateClip],
) -> CandidateScoreBreakdown:
    text = _source_text(candidate)
    sentences = _split_sentences(text)
    first_sentence = sentences[0] if sentences else text
    later_text = " ".join(sentences[1:]) if len(sentences) > 1 else ""
    words = WORD_RE.findall(text.lower())
    word_count = len(words)
    duration = candidate.end_sec - candidate.start_sec

    overlap_penalty = 0.0
    for other in all_candidates:
        if other.id == candidate.id:
            continue
        overlap_penalty = max(
            overlap_penalty,
            _time_overlap_ratio(candidate, other) * _word_jaccard(text, _source_text(other)) * 10.0,
        )

    hook_strength = 4.0 + min(3.0, _keyword_hits(first_sentence, INTEREST_TERMS | CONFLICT_TERMS | PAYOFF_TERMS) * 0.8)
    if "?" in first_sentence or "!" in first_sentence:
        hook_strength += 0.8
    if 8 <= len(WORD_RE.findall(first_sentence.lower())) <= 22:
        hook_strength += 0.6

    self_containedness = 4.5 + (1.6 if len(sentences) >= 2 else 0.8) + (0.8 if text.endswith((".", "!", "?")) else 0.0)
    conflict_tension = 2.0 + min(4.0, _keyword_hits(text, CONFLICT_TERMS) * 1.2)
    payoff_clarity = 3.0 + min(4.5, (_keyword_hits(later_text or text, PAYOFF_TERMS) * 1.3) + (_keyword_hits(text, {"because", "so", "therefore"}) * 0.7))
    novelty_interestingness = 3.0 + min(3.5, _keyword_hits(text, INTEREST_TERMS) * 1.0) + (0.7 if any(char.isdigit() for char in text) else 0.0)
    niche_relevance = 3.0 + min(5.0, _keyword_hits(text, TECHNICAL_TERMS) * 0.9)

    verbosity_penalty = 1.0
    if word_count > 70:
        verbosity_penalty += min(5.0, (word_count - 70) / 14.0)
    if duration > 55:
        verbosity_penalty += min(2.0, (duration - 55) / 12.0)

    return CandidateScoreBreakdown(
        hook_strength=round(_clamp(hook_strength, 0, 10), 2),
        self_containedness=round(_clamp(self_containedness, 0, 10), 2),
        conflict_tension=round(_clamp(conflict_tension, 0, 10), 2),
        payoff_clarity=round(_clamp(payoff_clarity, 0, 10), 2),
        novelty_interestingness=round(_clamp(novelty_interestingness, 0, 10), 2),
        niche_relevance=round(_clamp(niche_relevance, 0, 10), 2),
        verbosity_penalty=round(_clamp(verbosity_penalty, 0, 10), 2),
        overlap_duplication_penalty=round(_clamp(overlap_penalty, 0, 10), 2),
    )


def _score_total_from_breakdown(breakdown: CandidateScoreBreakdown, weights: dict[str, float]) -> float:
    raw_score = sum(getattr(breakdown, key) * value for key, value in weights.items())
    positive_max = 10.0 * sum(value for value in weights.values() if value > 0)
    negative_max = 10.0 * sum(-value for value in weights.values() if value < 0)
    denominator = positive_max + negative_max
    if denominator <= 0:
        return 0.0
    return round(_clamp(((raw_score + negative_max) / denominator) * 100.0, 0, 100), 2)


def _fallback_title(candidate: CandidateClip) -> str:
    sentence = _split_sentences(_source_text(candidate))
    if not sentence:
        return candidate.title or candidate.id
    return _truncate_text(sentence[0].rstrip(".!?\"') ]"), 72) or candidate.id


def _fallback_hook(candidate: CandidateClip) -> str:
    excerpt = _compact_candidate_excerpt(candidate, 140)
    return excerpt or candidate.title or candidate.id


def _fallback_rationale(*, breakdown: CandidateScoreBreakdown, degraded: bool) -> str:
    signals = sorted(
        (
            ("hook", breakdown.hook_strength),
            ("self-contained setup", breakdown.self_containedness),
            ("payoff", breakdown.payoff_clarity),
            ("niche relevance", breakdown.niche_relevance),
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    labels = " and ".join(label for label, _ in signals[:2])
    tail = " Heuristic fallback was used after a planner timeout." if degraded else " Planner enrichment was reserved for higher-ranked clips."
    return f"Strongest signals were {labels}.{tail}".strip()


def _heuristic_candidates(
    *,
    candidates: list[CandidateClip],
    all_candidates: list[CandidateClip],
    weights: dict[str, float],
    degraded: bool,
) -> list[CandidateClip]:
    fallback_ranked: list[CandidateClip] = []
    for candidate in candidates:
        breakdown = _heuristic_breakdown(candidate, all_candidates=all_candidates)
        scored_candidate = candidate.model_copy(
            update={
                "title": _fallback_title(candidate),
                "hook_text": _fallback_hook(candidate),
                "score_total": _score_total_from_breakdown(breakdown, weights),
                "score_breakdown": breakdown,
                "rationale": _fallback_rationale(breakdown=breakdown, degraded=degraded),
                "tags": candidate.tags[:8],
                "duplicate_group": candidate.duplicate_group,
            }
        )
        fallback_ranked.append(scored_candidate)
    return fallback_ranked


def normalize_scored_candidates(
    *,
    candidates: list[CandidateClip],
    scoring_result: CandidateBatchScoringResult,
    all_candidates: list[CandidateClip],
    weights: dict[str, float],
    log_messages: list[str] | None = None,
) -> list[CandidateClip]:
    scores_by_id = {item.id: item for item in scoring_result.candidates}
    heuristic_by_id = {
        item.id: item
        for item in _heuristic_candidates(candidates=candidates, all_candidates=all_candidates, weights=weights, degraded=True)
    }
    normalized: list[CandidateClip] = []
    missing_count = 0

    for candidate in candidates:
        score = scores_by_id.get(candidate.id)
        if score is None:
            missing_count += 1
            normalized.append(heuristic_by_id[candidate.id].model_copy())
            continue

        normalized.append(
            candidate.model_copy(
                update={
                    "title": _fallback_title(candidate),
                    "hook_text": _fallback_hook(candidate),
                    "rationale": _fallback_rationale(breakdown=score.score_breakdown, degraded=False),
                    "score_total": round(score.score_total, 2),
                    "score_breakdown": score.score_breakdown,
                    "tags": [tag.strip() for tag in score.tags if tag.strip()][:8],
                    "duplicate_group": score.duplicate_group,
                }
            )
        )

    unknown_count = len([item for item in scoring_result.candidates if item.id not in {candidate.id for candidate in candidates}])
    if missing_count:
        _append_log(log_messages, f"Planner omitted {missing_count} candidate scores; used deterministic fallback scores for them.")
    if unknown_count:
        _append_log(log_messages, f"Ignored {unknown_count} planner scores for unknown candidate IDs.")

    return normalized


def _request_structured_payload(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: int,
) -> tuple[dict[str, Any], str]:
    response_text = llm.request_planner_completion(
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        timeout_seconds=timeout_seconds,
    )
    return json.loads(_extract_json_blob(response_text)), response_text


def _apply_enrichment(
    *,
    scored_candidates: list[CandidateClip],
    enrichment_result: CandidateEnrichmentResult,
    log_messages: list[str] | None,
) -> list[CandidateClip]:
    by_id = {item.id: item for item in enrichment_result.candidates}
    missing_count = 0
    enriched: list[CandidateClip] = []
    for candidate in scored_candidates:
        enrichment = by_id.get(candidate.id)
        if enrichment is None:
            missing_count += 1
            enriched.append(candidate)
            continue
        enriched.append(
            candidate.model_copy(
                update={
                    "title": enrichment.title.strip(),
                    "hook_text": enrichment.hook_text.strip(),
                    "rationale": enrichment.rationale.strip(),
                }
            )
        )
    if missing_count:
        _append_log(log_messages, f"Planner omitted {missing_count} enrichment items; kept deterministic fallback copy.")
    unknown_count = len([item for item in enrichment_result.candidates if item.id not in {candidate.id for candidate in scored_candidates}])
    if unknown_count:
        _append_log(log_messages, f"Ignored {unknown_count} planner enrichment items for unknown candidate IDs.")
    return enriched


def _fallback_enrichment_candidates(
    *,
    candidates: list[CandidateClip],
    degraded: bool,
) -> list[CandidateClip]:
    enriched: list[CandidateClip] = []
    for candidate in candidates:
        breakdown = candidate.score_breakdown or _fallback_breakdown()
        enriched.append(
            candidate.model_copy(
                update={
                    "title": _fallback_title(candidate),
                    "hook_text": _fallback_hook(candidate),
                    "rationale": _fallback_rationale(breakdown=breakdown, degraded=degraded),
                }
            )
        )
    return enriched


def _record_trace_event(
    trace_events: list[PlannerTraceEvent],
    *,
    stage: str,
    event: str,
    message: str,
    severity: str = "info",
    payload: dict[str, Any] | None = None,
) -> None:
    trace_events.append(
        PlannerTraceEvent(stage=stage, event=event, message=message, severity=severity, payload=payload)
    )


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
    artifact_dir: Path | None = None,
) -> CandidateScoringOutcome:
    if not candidates:
        return CandidateScoringOutcome(candidates=[])

    weights = {**DEFAULT_SCORING_WEIGHTS, **preset.scoring_weights}
    batch_size = _planner_setting_int(settings, "planner_scoring_batch_size", 3)
    retry_batch_size = min(batch_size, _planner_setting_int(settings, "planner_scoring_retry_batch_size", 1))
    excerpt_char_limit = _planner_setting_int(settings, "planner_scoring_excerpt_char_limit", 360)
    retry_excerpt_char_limit = min(excerpt_char_limit, _planner_setting_int(settings, "planner_scoring_retry_excerpt_char_limit", 220))
    enrichment_top_n = _planner_setting_int(settings, "planner_enrichment_top_n", 3)
    enrichment_excerpt_char_limit = _planner_setting_int(settings, "planner_enrichment_excerpt_char_limit", 280)

    prompt_sections: list[str] = []
    response_payload: dict[str, Any] = {
        "ranking_batches": [],
        "enrichment": None,
        "degraded": False,
        "notes_for_user": [],
        "final_candidates": [],
    }
    trace_events: list[PlannerTraceEvent] = []
    degraded = False
    retry_happened = False
    degraded_candidate_ids: list[str] = []

    try:
        scored_candidates: list[CandidateClip] = []
        for batch_index, batch in enumerate(_batched(candidates, batch_size), start=1):
            batch_ids = [candidate.id for candidate in batch]
            prompt, excerpt_lengths = _build_scoring_prompt(
                source_filename=source_filename,
                source_duration=source_duration,
                preset=preset,
                weights=weights,
                user_notes=user_notes,
                candidates=batch,
                excerpt_char_limit=excerpt_char_limit,
            )
            _append_prompt_section(
                prompt_sections,
                label=f"Ranking batch {batch_index} primary attempt",
                system_prompt=SHORTS_SCORING_SYSTEM_PROMPT,
                user_prompt=prompt,
            )
            _record_trace_event(
                trace_events,
                stage="planner scoring",
                event="batch_started",
                message=f"Scoring batch {batch_index} with {len(batch)} candidates.",
                payload={
                    "batch_index": batch_index,
                    "batch_size": len(batch),
                    "candidate_ids": batch_ids,
                    "excerpt_lengths": excerpt_lengths,
                    "excerpt_char_limit": excerpt_char_limit,
                },
            )

            try:
                raw_payload, _ = _request_structured_payload(
                    base_url=llm_base_url,
                    model=llm_model,
                    system_prompt=SHORTS_SCORING_SYSTEM_PROMPT,
                    user_prompt=prompt,
                    timeout_seconds=settings.llm_request_timeout_seconds,
                )
                scoring_result = CandidateBatchScoringResult.model_validate(raw_payload)
                normalized_batch = normalize_scored_candidates(
                    candidates=batch,
                    scoring_result=scoring_result,
                    all_candidates=candidates,
                    weights=weights,
                    log_messages=log_messages,
                )
                scored_candidates.extend(normalized_batch)
                response_payload["ranking_batches"].append(
                    {
                        "batch_index": batch_index,
                        "attempt": "primary",
                        "candidate_ids": batch_ids,
                        "excerpt_lengths": excerpt_lengths,
                        "response": raw_payload,
                    }
                )
                _record_trace_event(
                    trace_events,
                    stage="planner scoring",
                    event="batch_completed",
                    message=f"Planner scored batch {batch_index}.",
                    payload={
                        "batch_index": batch_index,
                        "batch_size": len(batch),
                        "candidate_ids": batch_ids,
                    },
                )
                continue
            except llm.PlannerTimeoutError as exc:
                retry_happened = True
                _append_log(log_messages, f"Planner scoring batch {batch_index} timed out; retrying with smaller batches and shorter excerpts.")
                _record_trace_event(
                    trace_events,
                    stage="planner scoring",
                    event="batch_retry_started",
                    message=f"Planner scoring batch {batch_index} timed out; retrying smaller prompts.",
                    severity="warning",
                    payload={
                        "batch_index": batch_index,
                        "batch_size": len(batch),
                        "candidate_ids": batch_ids,
                        "error": str(exc),
                        "retry_batch_size": retry_batch_size,
                        "retry_excerpt_char_limit": retry_excerpt_char_limit,
                    },
                )
                response_payload["ranking_batches"].append(
                    {
                        "batch_index": batch_index,
                        "attempt": "primary",
                        "candidate_ids": batch_ids,
                        "excerpt_lengths": excerpt_lengths,
                        "error": str(exc),
                    }
                )
            except Exception as exc:
                response_payload["error"] = str(exc)
                raise

            for retry_index, retry_batch in enumerate(_batched(batch, retry_batch_size), start=1):
                retry_ids = [candidate.id for candidate in retry_batch]
                retry_prompt, retry_lengths = _build_scoring_prompt(
                    source_filename=source_filename,
                    source_duration=source_duration,
                    preset=preset,
                    weights=weights,
                    user_notes=user_notes,
                    candidates=retry_batch,
                    excerpt_char_limit=retry_excerpt_char_limit,
                )
                _append_prompt_section(
                    prompt_sections,
                    label=f"Ranking batch {batch_index} retry {retry_index}",
                    system_prompt=SHORTS_SCORING_SYSTEM_PROMPT,
                    user_prompt=retry_prompt,
                )
                try:
                    raw_payload, _ = _request_structured_payload(
                        base_url=llm_base_url,
                        model=llm_model,
                        system_prompt=SHORTS_SCORING_SYSTEM_PROMPT,
                        user_prompt=retry_prompt,
                        timeout_seconds=settings.llm_request_timeout_seconds,
                    )
                    scoring_result = CandidateBatchScoringResult.model_validate(raw_payload)
                    normalized_batch = normalize_scored_candidates(
                        candidates=retry_batch,
                        scoring_result=scoring_result,
                        all_candidates=candidates,
                        weights=weights,
                        log_messages=log_messages,
                    )
                    scored_candidates.extend(normalized_batch)
                    response_payload["ranking_batches"].append(
                        {
                            "batch_index": batch_index,
                            "attempt": f"retry-{retry_index}",
                            "candidate_ids": retry_ids,
                            "excerpt_lengths": retry_lengths,
                            "response": raw_payload,
                        }
                    )
                    _record_trace_event(
                        trace_events,
                        stage="planner scoring",
                        event="batch_retry_completed",
                        message=f"Retry {retry_index} for batch {batch_index} succeeded.",
                        payload={
                            "batch_index": batch_index,
                            "retry_index": retry_index,
                            "batch_size": len(retry_batch),
                            "candidate_ids": retry_ids,
                            "excerpt_lengths": retry_lengths,
                        },
                    )
                except Exception as exc:
                    degraded = True
                    fallback_batch = _heuristic_candidates(
                        candidates=retry_batch,
                        all_candidates=candidates,
                        weights=weights,
                        degraded=True,
                    )
                    scored_candidates.extend(fallback_batch)
                    degraded_candidate_ids.extend(retry_ids)
                    response_payload["ranking_batches"].append(
                        {
                            "batch_index": batch_index,
                            "attempt": f"retry-{retry_index}",
                            "candidate_ids": retry_ids,
                            "excerpt_lengths": retry_lengths,
                            "fallback": "heuristic",
                            "error": str(exc),
                        }
                    )
                    _append_log(
                        log_messages,
                        f"Planner scoring retry {retry_index} for batch {batch_index} failed; used deterministic heuristic ranking for {len(retry_batch)} candidates.",
                    )
                    _record_trace_event(
                        trace_events,
                        stage="planner scoring",
                        event="batch_fallback_activated",
                        message=f"Retry {retry_index} for batch {batch_index} failed; using deterministic heuristic ranking.",
                        severity="warning",
                        payload={
                            "batch_index": batch_index,
                            "retry_index": retry_index,
                            "batch_size": len(retry_batch),
                            "candidate_ids": retry_ids,
                            "excerpt_lengths": retry_lengths,
                            "error": str(exc),
                        },
                    )

        ranked_candidates = sorted(scored_candidates, key=lambda item: item.score_total, reverse=True)
        top_candidates = ranked_candidates[: min(len(ranked_candidates), enrichment_top_n)]
        if top_candidates:
            enrichment_prompt, enrichment_lengths = _build_enrichment_prompt(
                source_filename=source_filename,
                source_duration=source_duration,
                preset=preset,
                user_notes=user_notes,
                candidates=top_candidates,
                excerpt_char_limit=enrichment_excerpt_char_limit,
            )
            _append_prompt_section(
                prompt_sections,
                label="Top candidate enrichment",
                system_prompt=SHORTS_ENRICHMENT_SYSTEM_PROMPT,
                user_prompt=enrichment_prompt,
            )
            _record_trace_event(
                trace_events,
                stage="planner enrichment",
                event="started",
                message=f"Generating titles, hooks, and rationales for the top {len(top_candidates)} candidates.",
                payload={
                    "candidate_ids": [candidate.id for candidate in top_candidates],
                    "excerpt_lengths": enrichment_lengths,
                    "excerpt_char_limit": enrichment_excerpt_char_limit,
                },
            )
            try:
                raw_payload, _ = _request_structured_payload(
                    base_url=llm_base_url,
                    model=llm_model,
                    system_prompt=SHORTS_ENRICHMENT_SYSTEM_PROMPT,
                    user_prompt=enrichment_prompt,
                    timeout_seconds=settings.llm_request_timeout_seconds,
                )
                enrichment_result = CandidateEnrichmentResult.model_validate(raw_payload)
                enriched_top_candidates = _apply_enrichment(
                    scored_candidates=top_candidates,
                    enrichment_result=enrichment_result,
                    log_messages=log_messages,
                )
                by_id = {candidate.id: candidate for candidate in enriched_top_candidates}
                ranked_candidates = [by_id.get(candidate.id, candidate) for candidate in ranked_candidates]
                response_payload["enrichment"] = {
                    "candidate_ids": [candidate.id for candidate in top_candidates],
                    "excerpt_lengths": enrichment_lengths,
                    "response": raw_payload,
                }
                _record_trace_event(
                    trace_events,
                    stage="planner enrichment",
                    event="completed",
                    message=f"Planner enriched the top {len(top_candidates)} candidates.",
                    payload={"candidate_ids": [candidate.id for candidate in top_candidates]},
                )
            except Exception as exc:
                degraded = True
                degraded_candidate_ids.extend(candidate.id for candidate in top_candidates)
                fallback_top = _fallback_enrichment_candidates(candidates=top_candidates, degraded=True)
                by_id = {candidate.id: candidate for candidate in fallback_top}
                ranked_candidates = [by_id.get(candidate.id, candidate) for candidate in ranked_candidates]
                response_payload["enrichment"] = {
                    "candidate_ids": [candidate.id for candidate in top_candidates],
                    "excerpt_lengths": enrichment_lengths,
                    "fallback": "heuristic",
                    "error": str(exc),
                }
                _append_log(log_messages, "Planner enrichment failed for the top ranked candidates; used deterministic fallback copy.")
                _record_trace_event(
                    trace_events,
                    stage="planner enrichment",
                    event="fallback_activated",
                    message="Planner enrichment failed; using deterministic fallback copy for the top ranked candidates.",
                    severity="warning",
                    payload={
                        "candidate_ids": [candidate.id for candidate in top_candidates],
                        "error": str(exc),
                    },
                )

        notes_for_user: list[str] = []
        if degraded:
            unique_degraded_ids = sorted(set(degraded_candidate_ids))
            notes_for_user.append(
                "Planner degraded during scoring or enrichment, so Roughcut retried smaller prompts and used deterministic fallback for some candidates."
            )
            _append_log(
                log_messages,
                f"Planner degraded for {len(unique_degraded_ids)} candidate IDs: {', '.join(unique_degraded_ids) if unique_degraded_ids else 'none'}.",
            )
        elif retry_happened:
            _append_log(log_messages, "Planner scoring recovered after retrying smaller prompts.")

        response_payload["degraded"] = degraded
        response_payload["notes_for_user"] = notes_for_user
        response_payload["final_candidates"] = [candidate.model_dump() for candidate in ranked_candidates]
        _append_log(log_messages, f"Planner scored {len(ranked_candidates)} shorts candidates.")
        return CandidateScoringOutcome(
            candidates=ranked_candidates,
            degraded=degraded,
            notes_for_user=notes_for_user,
            trace_events=trace_events,
        )
    except Exception as exc:
        response_payload["error"] = str(exc)
        raise
    finally:
        if prompt_sections:
            _write_scoring_artifacts(
                artifact_dir,
                prompt_sections=prompt_sections,
                response_payload=response_payload,
            )
