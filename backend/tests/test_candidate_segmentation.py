from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import PresetConfig, TranscriptArtifact, TranscriptSegment
from app.services import candidates


def _preset() -> PresetConfig:
    return PresetConfig(
        id="test_shorts",
        name="Test Shorts",
        description="Test preset.",
        silence_threshold_db=-38,
        minimum_silence_duration=0.35,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="shorts_clean",
        zoom_rule="none",
        shorts_behavior="generate candidates",
        cta_preservation="minimal",
        planner_hint="Find useful technical clips.",
        target_clip_min_sec=20,
        target_clip_max_sec=32,
        target_clip_ideal_sec=24,
        candidate_overlap_sec=4,
        max_candidates=6,
    )


class CandidateSegmentationTests(unittest.TestCase):
    def test_segments_transcript_into_multiple_non_overlapping_candidate_windows(self) -> None:
        segments = [
            TranscriptSegment(
                index=index,
                start=index * 6.0,
                end=index * 6.0 + 4.5,
                text=f"This is technical point {index}.",
                words=[],
            )
            for index in range(16)
        ]
        transcript = TranscriptArtifact(language="en", language_probability=1.0, segments=segments)

        result = candidates.segment_transcript_into_candidates(
            transcript,
            preset=_preset(),
            source_duration=100.0,
            aggressiveness="balanced",
        )

        self.assertGreaterEqual(len(result), 3)
        self.assertLessEqual(len(result), 6)
        self.assertEqual(result[0].id, "clip-001")
        for candidate in result:
            duration = candidate.end_sec - candidate.start_sec
            self.assertGreaterEqual(duration, 20)
            self.assertLessEqual(duration, 32)
            self.assertTrue(candidate.transcript_excerpt)
            self.assertTrue(candidate.subtitle_segments)
            self.assertTrue(all(segment.start >= 0 for segment in candidate.subtitle_segments))
            self.assertTrue(all(segment.end <= duration for segment in candidate.subtitle_segments))

        for left, right in zip(result, result[1:]):
            overlap = max(0.0, min(left.end_sec, right.end_sec) - max(left.start_sec, right.start_sec))
            self.assertLessEqual(overlap, 4.1)

    def test_empty_transcript_returns_no_candidates(self) -> None:
        transcript = TranscriptArtifact(language="en", language_probability=1.0, segments=[])
        result = candidates.segment_transcript_into_candidates(
            transcript,
            preset=_preset(),
            source_duration=60.0,
            aggressiveness="balanced",
        )

        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
