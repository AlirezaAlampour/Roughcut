from __future__ import annotations

from fractions import Fraction
import json
from pathlib import Path
import subprocess
from typing import Any

from app.config import Settings
from app.schemas import EditRange, SubtitleSegment, TranscriptSegment


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(args, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Command failed.")
    return completed


def _parse_frame_rate(value: str | None) -> float | None:
    if not value or value in {"0/0", "N/A"}:
        return None
    try:
        return float(Fraction(value))
    except Exception:
        return None


def probe_media(settings: Settings, media_path: Path) -> dict[str, Any]:
    completed = _run(
        [
            settings.ffprobe_binary,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(media_path),
        ]
    )
    payload = json.loads(completed.stdout or "{}")
    streams = payload.get("streams", [])
    format_info = payload.get("format", {})
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), None)
    duration = format_info.get("duration") or (video_stream or audio_stream or {}).get("duration")
    return {
        "has_video": video_stream is not None,
        "has_audio": audio_stream is not None,
        "source_mode": "video" if video_stream is not None else ("audio-only" if audio_stream is not None else None),
        "duration_seconds": float(duration) if duration else None,
        "width": video_stream.get("width") if video_stream else None,
        "height": video_stream.get("height") if video_stream else None,
        "frame_rate": _parse_frame_rate(video_stream.get("r_frame_rate")) if video_stream else None,
        "video_codec": video_stream.get("codec_name") if video_stream else None,
        "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        "audio_channels": audio_stream.get("channels") if audio_stream else None,
        "format_name": format_info.get("format_name"),
        "bit_rate": int(format_info["bit_rate"]) if format_info.get("bit_rate") else None,
    }


def source_mode_from_probe(probe: dict[str, Any]) -> str:
    if probe.get("has_video"):
        return "video"
    if probe.get("has_audio"):
        return "audio-only"
    raise RuntimeError("Source file has no renderable audio or video streams.")


def transcript_text(segments: list[TranscriptSegment]) -> str:
    return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()


def transcript_text_lines(segments: list[TranscriptSegment]) -> str:
    return "\n".join(
        f"[{segment.start:0.2f}-{segment.end:0.2f}] {text}"
        for segment in segments
        if (text := segment.text.strip())
    )


def write_transcript_text(path: Path, segments: list[TranscriptSegment]) -> None:
    path.write_text(transcript_text_lines(segments))


def _format_srt_timestamp(value: float) -> str:
    total_ms = int(round(max(value, 0) * 1000))
    hours = total_ms // 3_600_000
    minutes = (total_ms % 3_600_000) // 60_000
    seconds = (total_ms % 60_000) // 1_000
    milliseconds = total_ms % 1_000
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def remap_segments_to_keep_ranges(
    segments: list[TranscriptSegment], keep_ranges: list[EditRange]
) -> list[SubtitleSegment]:
    remapped: list[SubtitleSegment] = []
    output_cursor = 0.0
    for keep_range in keep_ranges:
        keep_duration = keep_range.end - keep_range.start
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            overlap_start = max(segment.start, keep_range.start)
            overlap_end = min(segment.end, keep_range.end)
            if overlap_end <= overlap_start:
                continue
            mapped_start = output_cursor + (overlap_start - keep_range.start)
            mapped_end = output_cursor + (overlap_end - keep_range.start)
            remapped.append(
                SubtitleSegment(
                    start=round(mapped_start, 3),
                    end=round(mapped_end, 3),
                    text=text,
                )
            )
        output_cursor += keep_duration
    return remapped


def write_srt(path: Path, segments: list[SubtitleSegment]) -> None:
    blocks = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{_format_srt_timestamp(segment.start)} --> {_format_srt_timestamp(segment.end)}",
                    segment.text.strip(),
                ]
            )
        )
    path.write_text("\n\n".join(blocks))


def artifact_file_has_content(path: Path | None) -> bool:
    if path is None:
        return False
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def subtitle_file_is_usable(path: Path | None) -> bool:
    return artifact_file_has_content(path)


def _quality_args(quality_preset: str) -> tuple[str, str]:
    mapping = {
        "draft": ("veryfast", "28"),
        "balanced": ("medium", "23"),
        "quality": ("slow", "20"),
    }
    return mapping.get(quality_preset, mapping["balanced"])


def render_rough_cut(
    settings: Settings,
    source_path: Path,
    output_path: Path,
    keep_ranges: list[EditRange],
    captions_path: Path | None,
    probe: dict[str, Any],
    quality_preset: str,
) -> None:
    if not keep_ranges:
        raise RuntimeError("No keep ranges available for rendering.")

    has_video = bool(probe.get("has_video"))
    has_audio = bool(probe.get("has_audio"))
    if not has_video and not has_audio:
        raise RuntimeError("Source file has no renderable audio or video streams.")

    filter_parts: list[str] = []
    concat_inputs: list[str] = []
    segment_count = len(keep_ranges)
    total_duration = sum(item.end - item.start for item in keep_ranges)

    for index, item in enumerate(keep_ranges):
        if has_video:
            filter_parts.append(
                f"[0:v]trim=start={item.start}:end={item.end},setpts=PTS-STARTPTS[v{index}]"
            )
        if has_audio:
            filter_parts.append(
                f"[0:a]atrim=start={item.start}:end={item.end},asetpts=PTS-STARTPTS[a{index}]"
            )

    audio_label = None
    if has_video and has_audio:
        concat_inputs = [f"[v{index}][a{index}]" for index in range(segment_count)]
        filter_parts.append("".join(concat_inputs) + f"concat=n={segment_count}:v=1:a=1[basev][basea]")
        video_label = "[basev]"
        audio_label = "[basea]"
    elif has_video:
        concat_inputs = [f"[v{index}]" for index in range(segment_count)]
        filter_parts.append("".join(concat_inputs) + f"concat=n={segment_count}:v=1:a=0[basev]")
        video_label = "[basev]"
    else:
        concat_inputs = [f"[a{index}]" for index in range(segment_count)]
        filter_parts.append("".join(concat_inputs) + f"concat=n={segment_count}:v=0:a=1[basea]")
        filter_parts.append(f"color=c=#F2EEE5:s=1920x1080:d={total_duration}[basev]")
        video_label = "[basev]"
        audio_label = "[basea]"

    final_video_label = video_label
    if has_video and subtitle_file_is_usable(captions_path):
        filter_parts.append(
            f"{video_label}subtitles={captions_path.as_posix()}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF&,OutlineColour=&H003D3128&,BorderStyle=1,Outline=1,Shadow=0,MarginV=32'[vout]"
        )
        final_video_label = "[vout]"

    preset, crf = _quality_args(quality_preset)
    args = [
        settings.ffmpeg_binary,
        "-y",
        "-i",
        str(source_path),
        "-filter_complex",
        ";".join(filter_parts),
        "-map",
        final_video_label,
    ]
    if audio_label is not None:
        args.extend(["-map", audio_label, "-c:a", "aac", "-b:a", "192k"])

    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            crf,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
    _run(args)
