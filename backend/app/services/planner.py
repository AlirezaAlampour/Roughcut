from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.schemas import EditPlan, EditRange, PresetConfig, TranscriptArtifact, TranscriptSegment
from app.services import llm

PLANNER_SYSTEM_PROMPT = """You are an expert YouTube rough-cut planner.

Return exactly one JSON object that matches the provided schema.
Do not include markdown fences, commentary, or prose before or after the JSON.
Keep ranges must be sorted, non-overlapping, and within the source duration.
Prefer preserving good content rather than over-cutting.
The output will be executed by deterministic code, so the JSON must be precise."""


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
    captions_enabled: bool,
    generate_shorts: bool,
) -> EditPlan:
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
            "enabled": captions_enabled and raw_plan.caption_strategy.enabled,
            "style": raw_plan.caption_strategy.style,
        },
        subtitle_segments=raw_plan.subtitle_segments,
        zoom_events=raw_plan.zoom_events,
        shorts_candidates=raw_plan.shorts_candidates if generate_shorts else [],
        notes_for_user=raw_plan.notes_for_user,
    )


def create_edit_plan(
    *,
    settings: Settings,
    llm_base_url: str,
    llm_model: str,
    source_filename: str,
    source_duration: float,
    preset: PresetConfig,
    transcript: TranscriptArtifact,
    aggressiveness: str,
    captions_enabled: bool,
    generate_shorts: bool,
    user_notes: str | None,
) -> EditPlan:
    schema = json.dumps(EditPlan.model_json_schema(), indent=2)
    prompt = f"""Create a rough-cut edit plan for one source file.

Source file: {source_filename}
Source duration (seconds): {source_duration}
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
    raw_plan = EditPlan.model_validate_json(_extract_json_blob(response_text))
    return normalize_edit_plan(
        raw_plan=raw_plan,
        source_file=source_filename,
        preset=preset,
        source_duration=source_duration,
        captions_enabled=captions_enabled,
        generate_shorts=generate_shorts,
    )

