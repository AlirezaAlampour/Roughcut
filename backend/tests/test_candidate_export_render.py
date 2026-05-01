from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import SubtitleSegment, WordTimestamp
from app.services import media


class CandidateExportRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.settings = SimpleNamespace(ffmpeg_binary="ffmpeg")
        self.source_path = self.root / "source.mp4"
        self.output_path = self.root / "clip.mp4"
        self.captions_path = self.root / "captions.srt"
        self.ass_path = self.root / "captions.ass"
        media.write_srt(
            self.captions_path,
            [SubtitleSegment(start=0, end=2, text="This is the hook.")],
        )

    def test_render_short_clip_uses_deterministic_vertical_filter_and_subtitles(self) -> None:
        with mock.patch("app.services.media._run") as run_mock:
            run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
            media.render_short_clip(
                self.settings,
                source_path=self.source_path,
                output_path=self.output_path,
                start_sec=10,
                end_sec=40,
                captions_path=self.captions_path,
                probe={"has_video": True, "has_audio": True, "width": 1920, "height": 1080},
                quality_preset="draft",
                export_mode="vertical_9_16",
            )

        args = run_mock.call_args.args[0]
        filter_complex = args[args.index("-filter_complex") + 1]
        self.assertIn("trim=start=10:end=40", filter_complex)
        self.assertIn("scale=1080:1920:force_original_aspect_ratio=increase", filter_complex)
        self.assertIn("crop=1080:1920", filter_complex)
        self.assertIn("subtitles=", filter_complex)
        self.assertIn("atrim=start=10:end=40", filter_complex)
        self.assertIn("-crf", args)

    def test_center_blur_fill_uses_blurred_background_and_centered_foreground(self) -> None:
        command_path = self.root / "render-command.txt"
        with mock.patch("app.services.media._run") as run_mock:
            run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
            media.render_short_clip(
                self.settings,
                source_path=self.source_path,
                output_path=self.output_path,
                start_sec=5,
                end_sec=20,
                captions_path=None,
                probe={"has_video": True, "has_audio": True, "width": 1920, "height": 1080},
                quality_preset="balanced",
                export_mode="center_blur_fill",
                blur_intensity=34,
                hook_text="Local-first editing wins when the workflow stays boring.",
                command_log_path=command_path,
            )

        args = run_mock.call_args.args[0]
        filter_complex = args[args.index("-filter_complex") + 1]
        self.assertIn("split=2[fgsrc][bgsrc]", filter_complex)
        self.assertIn("gblur=sigma=34.0", filter_complex)
        self.assertIn("scale=1080:1920:force_original_aspect_ratio=decrease", filter_complex)
        self.assertIn("overlay=(W-w)/2:(H-h)/2", filter_complex)
        self.assertIn("drawbox=", filter_complex)
        self.assertIn("drawtext=textfile=", filter_complex)
        self.assertTrue(command_path.exists())
        self.assertIn("gblur=sigma=34.0", command_path.read_text())

    def test_hook_overlay_text_uses_title_fallback_and_caps_line_count(self) -> None:
        self.assertEqual(media.hook_overlay_text("", "Fallback title"), "Fallback title")
        wrapped = media._wrap_hook_overlay_text(
            "This is a longer hook that should still be trimmed into no more than three readable lines for the exported preview."
        )
        self.assertLessEqual(len(wrapped), 3)
        self.assertTrue(all(line.strip() for line in wrapped))

    def test_word_timed_ass_captions_are_used_for_burned_caption_rendering(self) -> None:
        media.write_ass_karaoke(
            self.ass_path,
            [
                SubtitleSegment(
                    start=0,
                    end=1.6,
                    text="This is the hook",
                    words=[
                        WordTimestamp(start=0.0, end=0.3, word="This"),
                        WordTimestamp(start=0.3, end=0.6, word="is"),
                        WordTimestamp(start=0.6, end=1.0, word="the"),
                        WordTimestamp(start=1.0, end=1.6, word="hook"),
                    ],
                )
            ],
            active_word_color="#FFE15D",
        )

        with mock.patch("app.services.media._run") as run_mock:
            run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
            media.render_short_clip(
                self.settings,
                source_path=self.source_path,
                output_path=self.output_path,
                start_sec=0,
                end_sec=4,
                captions_path=self.ass_path,
                probe={"has_video": True, "has_audio": False, "width": 1080, "height": 1920},
                quality_preset="draft",
                export_mode="center_blur_fill",
            )

        ass_payload = self.ass_path.read_text()
        args = run_mock.call_args.args[0]
        filter_complex = args[args.index("-filter_complex") + 1]
        self.assertGreaterEqual(ass_payload.count("Dialogue:"), 4)
        self.assertIn("&H005DE1FF&", ass_payload)
        self.assertIn(f"subtitles={self.ass_path.as_posix()}", filter_complex)
        self.assertNotIn("force_style", filter_complex)

    def test_write_vtt_generates_webvtt_artifact(self) -> None:
        path = self.root / "captions.vtt"
        media.write_vtt(path, [SubtitleSegment(start=0, end=2.25, text="Caption text.")])

        payload = path.read_text()
        self.assertTrue(payload.startswith("WEBVTT"))
        self.assertIn("00:00:00.000 --> 00:00:02.250", payload)
        self.assertIn("Caption text.", payload)


if __name__ == "__main__":
    unittest.main()
