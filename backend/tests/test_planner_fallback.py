from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import PresetConfig, TranscriptArtifact, TranscriptSegment
from app.services import media, planner


class PlannerFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = SimpleNamespace(ffmpeg_binary="ffmpeg", llm_request_timeout_seconds=30)
        self.preset = PresetConfig(
            id="talking_head_clean",
            name="Talking Head Clean",
            description="Clean talking-head edit.",
            silence_threshold_db=-38,
            minimum_silence_duration=0.35,
            filler_removal_aggressiveness="medium",
            cut_aggressiveness="balanced",
            caption_style="clean_minimal",
            zoom_rule="off",
            shorts_behavior="off",
            cta_preservation="standard",
            planner_hint="Preserve the strongest explanation beats.",
        )
        self.source_duration = 35.0
        self.source_filename = "input.mp4"

    def test_zero_transcript_uses_conservative_fallback_and_render_can_continue(self) -> None:
        transcript = TranscriptArtifact(language="en", language_probability=1.0, segments=[])
        log_messages: list[str] = []

        with mock.patch("app.services.planner.llm.request_planner_completion") as llm_mock:
            plan = planner.create_edit_plan(
                settings=self.settings,
                llm_base_url="http://localhost:11434/v1",
                llm_model="qwen3:32b",
                source_filename=self.source_filename,
                source_duration=self.source_duration,
                preset=self.preset,
                transcript=transcript,
                aggressiveness="balanced",
                captions_enabled=True,
                generate_shorts=False,
                user_notes=None,
                log_messages=log_messages,
            )

        llm_mock.assert_not_called()
        self.assertEqual(len(plan.keep_ranges), 1)
        self.assertEqual(plan.keep_ranges[0].start, 0.0)
        self.assertEqual(plan.keep_ranges[0].end, self.source_duration)
        self.assertEqual(plan.cut_ranges, [])
        self.assertFalse(plan.caption_strategy.enabled)
        self.assertEqual(plan.subtitle_segments, [])
        self.assertIn(
            "No speech was detected in the source audio. Generated a conservative no-cut plan.",
            plan.notes_for_user,
        )
        self.assertTrue(
            any(
                "Zero-transcript fallback engaged. Skipping planner generation and using a conservative full-keep plan."
                in message
                for message in log_messages
            )
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "rough-cut.mp4"
            with mock.patch("app.services.media._run") as run_mock:
                run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
                media.render_rough_cut(
                    self.settings,
                    source_path=Path(temp_dir) / "input.mp4",
                    output_path=output_path,
                    keep_ranges=plan.keep_ranges,
                    captions_path=None,
                    probe={"has_video": True, "has_audio": True},
                    quality_preset="balanced",
                )

            filter_complex = run_mock.call_args.args[0][run_mock.call_args.args[0].index("-filter_complex") + 1]
            self.assertNotIn("subtitles=", filter_complex)

    def test_planner_sanitizes_malformed_zero_length_cut_range(self) -> None:
        transcript = TranscriptArtifact(
            language="en",
            language_probability=1.0,
            segments=[
                TranscriptSegment(index=0, start=0.0, end=10.0, text="Intro and explanation.", words=[]),
            ],
        )
        log_messages: list[str] = []
        planner_payload = {
            "source_file": self.source_filename,
            "preset": self.preset.name,
            "transcript_summary": "Speech detected.",
            "keep_ranges": [{"start": 0.0, "end": 12.0, "reason": "hook"}],
            "cut_ranges": [{"start": 35.0, "end": 35.0, "reason": "bad cut"}],
            "caption_strategy": {"enabled": True, "style": "clean_minimal"},
            "subtitle_segments": [],
            "zoom_events": [],
            "shorts_candidates": [],
            "notes_for_user": [],
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            return_value=json.dumps(planner_payload),
        ):
            plan = planner.create_edit_plan(
                settings=self.settings,
                llm_base_url="http://localhost:11434/v1",
                llm_model="qwen3:32b",
                source_filename=self.source_filename,
                source_duration=self.source_duration,
                preset=self.preset,
                transcript=transcript,
                aggressiveness="balanced",
                captions_enabled=True,
                generate_shorts=False,
                user_notes=None,
                log_messages=log_messages,
            )

        self.assertEqual(len(plan.keep_ranges), 1)
        self.assertEqual(plan.keep_ranges[0].start, 0.0)
        self.assertEqual(plan.keep_ranges[0].end, 12.0)
        self.assertTrue(all(item.end > item.start for item in plan.cut_ranges))
        self.assertTrue(
            any(
                "Removed 1 malformed planner cut_ranges where end <= start or timestamps were invalid."
                in message
                for message in log_messages
            )
        )

    def test_planner_falls_back_when_all_keep_ranges_are_invalid(self) -> None:
        transcript = TranscriptArtifact(
            language="en",
            language_probability=1.0,
            segments=[
                TranscriptSegment(index=0, start=0.0, end=10.0, text="Intro and explanation.", words=[]),
            ],
        )
        log_messages: list[str] = []
        planner_payload = {
            "source_file": self.source_filename,
            "preset": self.preset.name,
            "transcript_summary": "Speech detected.",
            "keep_ranges": [{"start": 35.0, "end": 35.0, "reason": "bad keep"}],
            "cut_ranges": [],
            "caption_strategy": {"enabled": True, "style": "clean_minimal"},
            "subtitle_segments": [],
            "zoom_events": [],
            "shorts_candidates": [],
            "notes_for_user": [],
        }

        with mock.patch(
            "app.services.planner.llm.request_planner_completion",
            return_value=json.dumps(planner_payload),
        ):
            plan = planner.create_edit_plan(
                settings=self.settings,
                llm_base_url="http://localhost:11434/v1",
                llm_model="qwen3:32b",
                source_filename=self.source_filename,
                source_duration=self.source_duration,
                preset=self.preset,
                transcript=transcript,
                aggressiveness="balanced",
                captions_enabled=True,
                generate_shorts=False,
                user_notes=None,
                log_messages=log_messages,
            )

        self.assertEqual(len(plan.keep_ranges), 1)
        self.assertEqual(plan.keep_ranges[0].start, 0.0)
        self.assertEqual(plan.keep_ranges[0].end, self.source_duration)
        self.assertTrue(plan.caption_strategy.enabled)
        self.assertEqual(plan.cut_ranges, [])
        self.assertIn(
            "Planner output was malformed after sanitization. Generated a conservative no-cut plan.",
            plan.notes_for_user,
        )
        self.assertTrue(
            any(
                "Planner returned no usable keep ranges after sanitization; using a conservative full-keep fallback plan."
                in message
                for message in log_messages
            )
        )


if __name__ == "__main__":
    unittest.main()
