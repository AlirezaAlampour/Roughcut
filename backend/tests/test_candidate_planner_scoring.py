from __future__ import annotations

import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import CandidateClip, PresetConfig, SubtitleSegment
from app.services import planner


def _preset() -> PresetConfig:
    return PresetConfig(
        id="local_ai_experiment",
        name="Local AI Experiment",
        description="Find local AI lessons.",
        silence_threshold_db=-38,
        minimum_silence_duration=0.35,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="shorts_clean",
        zoom_rule="none",
        shorts_behavior="rank candidates",
        cta_preservation="minimal",
        planner_hint="Favor practical local AI moments.",
        target_clip_min_sec=20,
        target_clip_max_sec=60,
        target_clip_ideal_sec=35,
    )


def _breakdown(**overrides: float) -> dict[str, float]:
    payload = {
        "hook_strength": 7.5,
        "self_containedness": 8.0,
        "conflict_tension": 6.0,
        "payoff_clarity": 8.0,
        "novelty_interestingness": 7.0,
        "niche_relevance": 9.0,
        "verbosity_penalty": 2.0,
        "overlap_duplication_penalty": 1.0,
    }
    payload.update(overrides)
    return payload


class CandidatePlannerScoringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = SimpleNamespace(llm_request_timeout_seconds=30)
        self.candidates = [
            CandidateClip(
                id="clip-001",
                start_sec=0,
                end_sec=30,
                transcript_excerpt="This local model failed, and here is why the setup mattered.",
                subtitle_segments=[SubtitleSegment(start=0, end=4, text="This local model failed.")],
            ),
            CandidateClip(
                id="clip-002",
                start_sec=32,
                end_sec=62,
                transcript_excerpt="The surprising fix was changing the quantization and keeping the workflow local.",
                subtitle_segments=[SubtitleSegment(start=0, end=5, text="The surprising fix was changing quantization.")],
            ),
        ]

    def test_score_short_candidates_validates_and_sorts_planner_json(self) -> None:
        planner_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 72,
                    "score_breakdown": _breakdown(),
                    "title": "Why the Local Model Failed",
                    "hook_text": "The failure was not the model.",
                    "rationale": "Useful setup and payoff, but a softer hook.",
                    "tags": ["local-ai", "debugging"],
                    "duplicate_group": None,
                },
                {
                    "id": "clip-002",
                    "score_total": 91,
                    "score_breakdown": _breakdown(hook_strength=9.0),
                    "title": "The Quantization Fix",
                    "hook_text": "One setting made the local workflow work.",
                    "rationale": "Strong technical payoff and clear niche relevance.",
                    "tags": ["local-ai", "workflow"],
                    "duplicate_group": None,
                },
            ]
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            return_value=json.dumps(planner_payload),
        ):
            result = planner.score_short_candidates(
                settings=self.settings,
                llm_base_url="http://localhost:11434/v1",
                llm_model="planner-model",
                source_filename="source.mp4",
                source_duration=120,
                preset=_preset(),
                candidates=self.candidates,
                user_notes="Favor technical payoff.",
                log_messages=[],
            )

        self.assertEqual([candidate.id for candidate in result], ["clip-002", "clip-001"])
        self.assertEqual(result[0].title, "The Quantization Fix")
        self.assertEqual(result[0].score_breakdown.hook_strength, 9.0)
        self.assertEqual(result[0].tags, ["local-ai", "workflow"])

    def test_score_short_candidates_rejects_malformed_planner_json(self) -> None:
        malformed_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 102,
                    "score_breakdown": _breakdown(),
                    "hook_text": "Missing title and score is out of range.",
                    "rationale": "Invalid.",
                    "tags": [],
                }
            ]
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            return_value=json.dumps(malformed_payload),
        ):
            with self.assertRaises(Exception):
                planner.score_short_candidates(
                    settings=self.settings,
                    llm_base_url="http://localhost:11434/v1",
                    llm_model="planner-model",
                    source_filename="source.mp4",
                    source_duration=120,
                    preset=_preset(),
                    candidates=self.candidates,
                    user_notes=None,
                    log_messages=[],
                )


if __name__ == "__main__":
    unittest.main()
