from __future__ import annotations

import re

from app.schemas import CandidateClip, PresetConfig, TranscriptArtifact, TranscriptSegment
from app.services import media

SENTENCE_END_RE = re.compile(r"[.!?][\"')\]]?$")


def _clip_duration_bounds(preset: PresetConfig, aggressiveness: str) -> tuple[float, float, float]:
    min_duration = max(8.0, float(preset.target_clip_min_sec))
    max_duration = max(min_duration + 5.0, float(preset.target_clip_max_sec))
    ideal_duration = min(max(float(preset.target_clip_ideal_sec), min_duration), max_duration)

    if aggressiveness == "conservative":
        ideal_duration = min(max_duration, ideal_duration + 10.0)
    elif aggressiveness == "aggressive":
        ideal_duration = max(min_duration, ideal_duration - 8.0)

    return min_duration, max_duration, ideal_duration


def _clean_excerpt(segments: list[TranscriptSegment], *, start_sec: float, end_sec: float) -> str:
    text = " ".join(
        segment.text.strip()
        for segment in segments
        if segment.text.strip() and segment.end > start_sec and segment.start < end_sec
    )
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= 1400:
        return text
    return f"{text[:1397].rstrip()}..."


def _is_sentence_boundary(segment: TranscriptSegment) -> bool:
    return bool(SENTENCE_END_RE.search(segment.text.strip()))


def _pause_after(segments: list[TranscriptSegment], index: int) -> float:
    if index >= len(segments) - 1:
        return 0.0
    return max(0.0, segments[index + 1].start - segments[index].end)


def _choose_end_index(
    segments: list[TranscriptSegment],
    *,
    start_index: int,
    min_duration: float,
    max_duration: float,
    ideal_duration: float,
) -> int:
    start_sec = segments[start_index].start
    latest_usable = start_index
    first_minimum_boundary: int | None = None
    best_preferred_boundary: int | None = None

    for index in range(start_index, len(segments)):
        segment = segments[index]
        duration = segment.end - start_sec
        if duration > max_duration:
            break

        latest_usable = index
        good_boundary = _is_sentence_boundary(segment) or _pause_after(segments, index) >= 0.7
        if duration >= min_duration and good_boundary and first_minimum_boundary is None:
            first_minimum_boundary = index
        if duration >= ideal_duration and good_boundary:
            best_preferred_boundary = index
            break

    if best_preferred_boundary is not None:
        return best_preferred_boundary
    if first_minimum_boundary is not None:
        return first_minimum_boundary
    return latest_usable


def _next_start_index(
    segments: list[TranscriptSegment],
    *,
    current_start_index: int,
    end_sec: float,
    overlap_sec: float,
) -> int:
    next_start_time = max(segments[current_start_index].start + 1.0, end_sec - max(0.0, overlap_sec))
    for index in range(current_start_index + 1, len(segments)):
        if segments[index].start >= next_start_time:
            return index
    return len(segments)


def _time_overlap_ratio(left: CandidateClip, right: CandidateClip) -> float:
    overlap = max(0.0, min(left.end_sec, right.end_sec) - max(left.start_sec, right.start_sec))
    shorter = min(left.end_sec - left.start_sec, right.end_sec - right.start_sec)
    if shorter <= 0:
        return 0.0
    return overlap / shorter


def _word_jaccard(left: str, right: str) -> float:
    left_words = {word for word in re.findall(r"[a-z0-9']+", left.lower()) if len(word) > 2}
    right_words = {word for word in re.findall(r"[a-z0-9']+", right.lower()) if len(word) > 2}
    if not left_words or not right_words:
        return 0.0
    return len(left_words & right_words) / len(left_words | right_words)


def _dedupe_candidates(candidates: list[CandidateClip]) -> list[CandidateClip]:
    deduped: list[CandidateClip] = []
    for candidate in candidates:
        duplicate = False
        for existing in deduped:
            if _time_overlap_ratio(candidate, existing) > 0.6 and _word_jaccard(
                candidate.transcript_excerpt, existing.transcript_excerpt
            ) > 0.55:
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)
    return deduped


def segment_transcript_into_candidates(
    transcript: TranscriptArtifact,
    *,
    preset: PresetConfig,
    source_duration: float,
    aggressiveness: str,
) -> list[CandidateClip]:
    segments = sorted(
        [segment for segment in transcript.segments if segment.text.strip() and segment.end > segment.start],
        key=lambda segment: segment.start,
    )
    if not segments:
        return []

    min_duration, max_duration, ideal_duration = _clip_duration_bounds(preset, aggressiveness)
    max_candidates = max(1, int(preset.max_candidates))
    overlap_sec = min(float(preset.candidate_overlap_sec), min_duration * 0.4)

    candidates: list[CandidateClip] = []
    start_index = 0
    while start_index < len(segments) and len(candidates) < max_candidates:
        start_sec = round(max(0.0, segments[start_index].start), 3)
        end_index = _choose_end_index(
            segments,
            start_index=start_index,
            min_duration=min_duration,
            max_duration=max_duration,
            ideal_duration=ideal_duration,
        )
        end_sec = round(min(source_duration, segments[end_index].end, start_sec + max_duration), 3)

        if end_sec - start_sec < min(6.0, min_duration):
            break

        excerpt = _clean_excerpt(segments, start_sec=start_sec, end_sec=end_sec)
        if excerpt:
            candidate_number = len(candidates) + 1
            candidates.append(
                CandidateClip(
                    id=f"clip-{candidate_number:03d}",
                    start_sec=start_sec,
                    end_sec=end_sec,
                    transcript_excerpt=excerpt,
                    title=f"Shorts candidate {candidate_number}",
                    hook_text="",
                    rationale="Pending planner scoring.",
                    tags=[],
                    subtitle_segments=media.remap_segments_to_time_range(segments, start_sec, end_sec),
                )
            )

        next_index = _next_start_index(
            segments,
            current_start_index=start_index,
            end_sec=end_sec,
            overlap_sec=overlap_sec,
        )
        if next_index <= start_index:
            next_index = end_index + 1
        start_index = next_index

    deduped = _dedupe_candidates(candidates)[:max_candidates]
    return [
        candidate.model_copy(update={"id": f"clip-{index:03d}", "title": f"Shorts candidate {index}"})
        for index, candidate in enumerate(deduped, start=1)
    ]
