from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import CandidateClip, PresetConfig, SubtitleSegment
from app.services import llm, planner


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
        self.settings = SimpleNamespace(
            llm_request_timeout_seconds=30,
            planner_scoring_batch_size=3,
            planner_scoring_retry_batch_size=1,
            planner_scoring_excerpt_char_limit=360,
            planner_scoring_retry_excerpt_char_limit=220,
            planner_enrichment_top_n=3,
            planner_enrichment_excerpt_char_limit=280,
        )
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
            CandidateClip(
                id="clip-003",
                start_sec=64,
                end_sec=90,
                transcript_excerpt="We almost blamed the model, but the real issue was the endpoint shape.",
                subtitle_segments=[SubtitleSegment(start=0, end=5, text="The real issue was the endpoint shape.")],
            ),
            CandidateClip(
                id="clip-004",
                start_sec=92,
                end_sec=120,
                transcript_excerpt="One tiny settings change made the local workflow stable again.",
                subtitle_segments=[SubtitleSegment(start=0, end=5, text="One tiny settings change made it stable.")],
            ),
        ]

    def test_score_short_candidates_batches_scoring_and_enriches_top_candidates(self) -> None:
        first_batch_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 72,
                    "score_breakdown": _breakdown(),
                    "tags": ["local-ai", "debugging"],
                    "duplicate_group": None,
                },
                {
                    "id": "clip-002",
                    "score_total": 91,
                    "score_breakdown": _breakdown(hook_strength=9.0),
                    "tags": ["local-ai", "workflow"],
                    "duplicate_group": None,
                },
                {
                    "id": "clip-003",
                    "score_total": 65,
                    "score_breakdown": _breakdown(payoff_clarity=6.5),
                    "tags": ["api", "debugging"],
                    "duplicate_group": None,
                },
            ]
        }
        second_batch_payload = {
            "candidates": [
                {
                    "id": "clip-004",
                    "score_total": 83,
                    "score_breakdown": _breakdown(hook_strength=8.6, payoff_clarity=8.8),
                    "tags": ["workflow", "settings"],
                    "duplicate_group": None,
                }
            ]
        }
        enrichment_payload = {
            "candidates": [
                {
                    "id": "clip-002",
                    "title": "The Quantization Fix",
                    "hook_text": "One setting made the local workflow work.",
                    "rationale": "Strong technical payoff and clear niche relevance.",
                },
                {
                    "id": "clip-004",
                    "title": "The Tiny Settings Change",
                    "hook_text": "A small config tweak made the whole local pipeline stable.",
                    "rationale": "Clear payoff with a practical local-first lesson.",
                },
                {
                    "id": "clip-001",
                    "title": "Why the Local Model Failed",
                    "hook_text": "The failure was not the model.",
                    "rationale": "Useful setup and payoff, but a softer hook.",
                },
            ]
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            side_effect=[
                json.dumps(first_batch_payload),
                json.dumps(second_batch_payload),
                json.dumps(enrichment_payload),
            ],
        ) as llm_mock:
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

        self.assertEqual(llm_mock.call_count, 3)
        self.assertEqual([candidate.id for candidate in result.candidates], ["clip-002", "clip-004", "clip-001", "clip-003"])
        self.assertEqual(result.candidates[0].title, "The Quantization Fix")
        self.assertEqual(result.candidates[1].title, "The Tiny Settings Change")
        self.assertEqual(result.candidates[0].score_breakdown.hook_strength, 9.0)
        self.assertEqual(result.candidates[0].tags, ["local-ai", "workflow"])
        self.assertEqual(result.candidates[3].title, "We almost blamed the model, but the real issue was the endpoint shape")
        self.assertTrue(any(event.event == "batch_started" and event.payload["batch_size"] == 3 for event in result.trace_events))
        self.assertTrue(any(event.stage == "planner enrichment" and event.event == "completed" for event in result.trace_events))

    def test_score_short_candidates_persists_planner_prompt_and_response_artifacts(self) -> None:
        ranking_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 72,
                    "score_breakdown": _breakdown(),
                    "tags": ["local-ai"],
                    "duplicate_group": None,
                },
                {
                    "id": "clip-002",
                    "score_total": 91,
                    "score_breakdown": _breakdown(hook_strength=9.0),
                    "tags": ["workflow"],
                    "duplicate_group": None,
                },
            ]
        }
        enrichment_payload = {
            "candidates": [
                {
                    "id": "clip-002",
                    "title": "The Quantization Fix",
                    "hook_text": "One setting made the local workflow work.",
                    "rationale": "Strong technical payoff.",
                },
                {
                    "id": "clip-001",
                    "title": "Why the Local Model Failed",
                    "hook_text": "The failure was not the model.",
                    "rationale": "Useful setup and payoff, but a softer hook.",
                },
            ]
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_dir = Path(temp_dir)
            with mock.patch(
                "app.services.planner.llm.request_planner_completion",
                side_effect=[json.dumps(ranking_payload), json.dumps(enrichment_payload)],
            ):
                planner.score_short_candidates(
                    settings=self.settings,
                    llm_base_url="http://localhost:11434/v1",
                    llm_model="planner-model",
                    source_filename="source.mp4",
                    source_duration=120,
                    preset=_preset(),
                    candidates=self.candidates[:2],
                    user_notes="Favor technical payoff.",
                    log_messages=[],
                    artifact_dir=artifact_dir,
                )

            prompt = (artifact_dir / "planner-prompt.txt").read_text()
            response = json.loads((artifact_dir / "planner-response.json").read_text())

        self.assertIn("Ranking batch 1 primary attempt", prompt)
        self.assertIn("Top candidate enrichment", prompt)
        self.assertIn("Score and rank pre-segmented shorts candidates", prompt)
        self.assertEqual(response["ranking_batches"][0]["candidate_ids"], ["clip-001", "clip-002"])
        self.assertEqual(response["final_candidates"][0]["id"], "clip-002")

    def test_score_short_candidates_rejects_malformed_planner_json(self) -> None:
        malformed_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 102,
                    "score_breakdown": _breakdown(),
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
                    candidates=self.candidates[:2],
                    user_notes=None,
                    log_messages=[],
                )

    def test_score_short_candidates_retries_timeout_and_falls_back_deterministically(self) -> None:
        retry_success_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "score_total": 78,
                    "score_breakdown": _breakdown(hook_strength=8.1),
                    "tags": ["local-ai"],
                    "duplicate_group": None,
                }
            ]
        }
        enrichment_payload = {
            "candidates": [
                {
                    "id": "clip-001",
                    "title": "Why the Setup Broke",
                    "hook_text": "The model was not the real problem.",
                    "rationale": "Good debugging payoff and contained setup.",
                },
                {
                    "id": "clip-002",
                    "title": "The Quantization Fix",
                    "hook_text": "One setting made the local workflow work.",
                    "rationale": "Clear technical payoff.",
                },
            ]
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            side_effect=[
                llm.PlannerTimeoutError("timed out"),
                json.dumps(retry_success_payload),
                llm.PlannerTimeoutError("timed out again"),
                json.dumps(enrichment_payload),
            ],
        ):
            result = planner.score_short_candidates(
                settings=SimpleNamespace(
                    llm_request_timeout_seconds=30,
                    planner_scoring_batch_size=2,
                    planner_scoring_retry_batch_size=1,
                    planner_scoring_excerpt_char_limit=360,
                    planner_scoring_retry_excerpt_char_limit=220,
                    planner_enrichment_top_n=2,
                    planner_enrichment_excerpt_char_limit=280,
                ),
                llm_base_url="http://localhost:11434/v1",
                llm_model="planner-model",
                source_filename="source.mp4",
                source_duration=120,
                preset=_preset(),
                candidates=self.candidates[:2],
                user_notes=None,
                log_messages=[],
            )

        self.assertTrue(result.degraded)
        self.assertEqual(len(result.candidates), 2)
        self.assertTrue(any("Planner degraded" in note for note in result.notes_for_user))
        self.assertTrue(any(event.event == "batch_retry_started" for event in result.trace_events))
        self.assertTrue(any(event.event == "batch_fallback_activated" for event in result.trace_events))
        self.assertTrue(all(candidate.score_total >= 0 for candidate in result.candidates))


if __name__ == "__main__":
    unittest.main()
