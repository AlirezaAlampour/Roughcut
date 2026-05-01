from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import EditRange, TranscriptSegment, WordTimestamp
from app.services import media
from app.services.jobs import _prepare_subtitle_file, _prepare_transcript_text_file, _select_captions_path


class RenderCaptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.settings = SimpleNamespace(ffmpeg_binary="ffmpeg")
        self.source_path = self.root / "input.mp4"
        self.output_path = self.root / "rough-cut.mp4"
        self.probe = {"has_video": True, "has_audio": True}
        self.keep_ranges = [EditRange(start=0.0, end=3.0, reason="hook")]

    def _render_args(self, captions_path: Path | None) -> list[str]:
        with mock.patch("app.services.media._run") as run_mock:
            run_mock.return_value = subprocess.CompletedProcess(args=["ffmpeg"], returncode=0, stdout="", stderr="")
            media.render_rough_cut(
                self.settings,
                source_path=self.source_path,
                output_path=self.output_path,
                keep_ranges=self.keep_ranges,
                captions_path=captions_path,
                probe=self.probe,
                quality_preset="balanced",
            )
        return run_mock.call_args.args[0]

    def _filter_complex(self, args: list[str]) -> str:
        return args[args.index("-filter_complex") + 1]

    def test_captions_enabled_with_subtitle_segments_uses_subtitles_filter(self) -> None:
        log_lines: list[str] = []
        transcript_segments = [
            TranscriptSegment(
                index=0,
                start=0.0,
                end=2.5,
                text="Hello from Roughcut.",
                words=[
                    WordTimestamp(start=0.1, end=0.5, word="Hello"),
                    WordTimestamp(start=0.6, end=1.0, word="from"),
                    WordTimestamp(start=1.1, end=1.8, word="Roughcut"),
                ],
            ),
        ]

        transcript_path = _prepare_transcript_text_file(
            outputs_dir=self.root,
            transcript_segments=transcript_segments,
            log_lines=log_lines,
        )

        subtitle_segments, subtitle_path = _prepare_subtitle_file(
            outputs_dir=self.root,
            transcript_segments=transcript_segments,
            keep_ranges=self.keep_ranges,
            captions_enabled=True,
            log_lines=log_lines,
        )
        captions_path = _select_captions_path(
            captions_enabled=True,
            subtitle_path=subtitle_path,
            log_lines=log_lines,
        )
        args = self._render_args(captions_path)

        self.assertEqual(len(subtitle_segments), 1)
        self.assertEqual(len(subtitle_segments[0].words), 3)
        self.assertEqual(subtitle_segments[0].words[0].word, "Hello")
        self.assertIsNotNone(transcript_path)
        self.assertTrue(media.artifact_file_has_content(transcript_path))
        self.assertIsNotNone(subtitle_path)
        self.assertTrue(media.subtitle_file_is_usable(subtitle_path))
        self.assertEqual(captions_path, subtitle_path)
        self.assertIn("subtitles=", self._filter_complex(args))
        self.assertTrue(any("Wrote transcript.txt." in line for line in log_lines))
        self.assertTrue(any("Rendering with burned-in captions." in line for line in log_lines))

    def test_zero_transcript_segments_skip_transcript_and_subtitle_outputs(self) -> None:
        log_lines: list[str] = []

        transcript_path = _prepare_transcript_text_file(
            outputs_dir=self.root,
            transcript_segments=[],
            log_lines=log_lines,
        )
        subtitle_segments, subtitle_path = _prepare_subtitle_file(
            outputs_dir=self.root,
            transcript_segments=[],
            keep_ranges=self.keep_ranges,
            captions_enabled=True,
            log_lines=log_lines,
        )
        captions_path = _select_captions_path(
            captions_enabled=True,
            subtitle_path=subtitle_path,
            log_lines=log_lines,
        )
        args = self._render_args(captions_path)

        self.assertIsNone(transcript_path)
        self.assertFalse((self.root / "transcript.txt").exists())
        self.assertEqual(subtitle_segments, [])
        self.assertIsNone(subtitle_path)
        self.assertIsNone(captions_path)
        self.assertNotIn("subtitles=", self._filter_complex(args))
        self.assertTrue(any("Transcript artifact empty; skipping transcript.txt output." in line for line in log_lines))
        self.assertTrue(any("Captions artifact empty; skipping captions.srt output." in line for line in log_lines))
        self.assertTrue(
            any(
                "Captions requested but transcript/subtitle output was empty; rendering without subtitles."
                in line
                for line in log_lines
            )
        )

    def test_empty_captions_file_does_not_apply_subtitles_filter(self) -> None:
        log_lines: list[str] = []
        subtitle_path = self.root / "captions.srt"
        subtitle_path.write_text("")

        captions_path = _select_captions_path(
            captions_enabled=True,
            subtitle_path=subtitle_path,
            log_lines=log_lines,
        )
        args = self._render_args(captions_path)

        self.assertFalse(media.subtitle_file_is_usable(subtitle_path))
        self.assertIsNone(captions_path)
        self.assertNotIn("subtitles=", self._filter_complex(args))
        self.assertTrue(any("Captions artifact empty; skipping captions.srt output." in line for line in log_lines))
        self.assertTrue(
            any(
                "Captions requested but transcript/subtitle output was empty; rendering without subtitles."
                in line
                for line in log_lines
            )
        )

    def test_captions_disabled_renders_without_subtitles(self) -> None:
        log_lines: list[str] = []
        transcript_segments = [
            TranscriptSegment(index=0, start=0.0, end=2.5, text="Hello from Roughcut.", words=[]),
        ]

        subtitle_segments, subtitle_path = _prepare_subtitle_file(
            outputs_dir=self.root,
            transcript_segments=transcript_segments,
            keep_ranges=self.keep_ranges,
            captions_enabled=False,
            log_lines=log_lines,
        )
        captions_path = _select_captions_path(
            captions_enabled=False,
            subtitle_path=subtitle_path,
            log_lines=log_lines,
        )
        args = self._render_args(captions_path)

        self.assertEqual(len(subtitle_segments), 1)
        self.assertIsNotNone(subtitle_path)
        self.assertTrue(media.subtitle_file_is_usable(subtitle_path))
        self.assertIsNone(captions_path)
        self.assertNotIn("subtitles=", self._filter_complex(args))
        self.assertTrue(any("Captions disabled for this job; rendering without burned-in captions." in line for line in log_lines))


if __name__ == "__main__":
    unittest.main()
