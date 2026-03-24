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

from app.schemas import EditRange, PresetConfig, TranscriptArtifact, TranscriptSegment
from app.services import media, planner


class AudioModeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = SimpleNamespace(ffmpeg_binary="ffmpeg", llm_request_timeout_seconds=30)
        self.preset = PresetConfig(
            id="podcast_to_shorts",
            name="Podcast to Shorts",
            description="Tighten spoken-word source material.",
            silence_threshold_db=-38,
            minimum_silence_duration=0.35,
            filler_removal_aggressiveness="medium",
            cut_aggressiveness="balanced",
            caption_style="clean_minimal",
            zoom_rule="off",
            shorts_behavior="extract_candidates",
            cta_preservation="standard",
            planner_hint="Prioritize clear speech and pacing.",
        )

    def test_source_mode_from_probe_detects_audio_only_wav(self) -> None:
        self.assertEqual(
            media.source_mode_from_probe({"has_video": False, "has_audio": True}),
            "audio-only",
        )

    def test_source_mode_from_probe_detects_video_source(self) -> None:
        self.assertEqual(
            media.source_mode_from_probe({"has_video": True, "has_audio": True}),
            "video",
        )

    def test_audio_only_mode_disables_zoom_events_and_burned_in_captions(self) -> None:
        transcript = TranscriptArtifact(
            language="en",
            language_probability=1.0,
            segments=[
                TranscriptSegment(index=0, start=0.0, end=8.0, text="Audio-only explanation.", words=[]),
            ],
        )
        planner_payload = {
            "source_file": "clip.wav",
            "preset": self.preset.name,
            "transcript_summary": "Audio speech detected.",
            "keep_ranges": [{"start": 0.0, "end": 8.0, "reason": "main explanation"}],
            "cut_ranges": [],
            "caption_strategy": {"enabled": True, "style": "clean_minimal"},
            "subtitle_segments": [],
            "zoom_events": [{"start": 1.0, "end": 2.0, "scale": 1.08, "reason": "emphasis"}],
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
                source_filename="clip.wav",
                source_duration=8.0,
                preset=self.preset,
                transcript=transcript,
                source_mode="audio-only",
                aggressiveness="balanced",
                captions_enabled=True,
                generate_shorts=False,
                user_notes=None,
                log_messages=[],
            )

        self.assertFalse(plan.caption_strategy.enabled)
        self.assertEqual(plan.zoom_events, [])

    def test_audio_only_render_does_not_apply_subtitles_filter(self) -> None:
        keep_ranges = [EditRange(start=0.0, end=6.0, reason="keep full clip")]

        with tempfile.TemporaryDirectory() as temp_dir:
            captions_path = Path(temp_dir) / "captions.srt"
            captions_path.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n")

            with mock.patch("app.services.media._run") as run_mock:
                run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
                media.render_rough_cut(
                    self.settings,
                    source_path=Path(temp_dir) / "clip.wav",
                    output_path=Path(temp_dir) / "rough-cut.mp4",
                    keep_ranges=keep_ranges,
                    captions_path=captions_path,
                    probe={"has_video": False, "has_audio": True},
                    quality_preset="balanced",
                )

            filter_complex = run_mock.call_args.args[0][run_mock.call_args.args[0].index("-filter_complex") + 1]
            self.assertIn("color=c=", filter_complex)
            self.assertNotIn("subtitles=", filter_complex)


if __name__ == "__main__":
    unittest.main()
