from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import SubtitleSegment
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

    def test_write_vtt_generates_webvtt_artifact(self) -> None:
        path = self.root / "captions.vtt"
        media.write_vtt(path, [SubtitleSegment(start=0, end=2.25, text="Caption text.")])

        payload = path.read_text()
        self.assertTrue(payload.startswith("WEBVTT"))
        self.assertIn("00:00:00.000 --> 00:00:02.250", payload)
        self.assertIn("Caption text.", payload)


if __name__ == "__main__":
    unittest.main()
