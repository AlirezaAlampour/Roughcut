from __future__ import annotations

from fractions import Fraction
import json
from pathlib import Path
import re
import shlex
import subprocess
from typing import Any

from app.config import Settings
from app.schemas import EditRange, SubtitleSegment, TranscriptSegment, WordTimestamp


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


def _format_vtt_timestamp(value: float) -> str:
    return _format_srt_timestamp(value).replace(",", ".")


def _remap_words_to_range(
    words: list[WordTimestamp],
    *,
    range_start: float,
    range_end: float,
    output_offset: float,
) -> list[WordTimestamp]:
    remapped: list[WordTimestamp] = []
    for word in words:
        text = word.word.strip()
        if not text:
            continue
        overlap_start = max(float(word.start), range_start)
        overlap_end = min(float(word.end), range_end)
        if overlap_end <= overlap_start:
            continue
        remapped.append(
            WordTimestamp(
                start=round(overlap_start + output_offset, 3),
                end=round(overlap_end + output_offset, 3),
                word=text,
            )
        )
    return remapped


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
                    words=_remap_words_to_range(
                        segment.words,
                        range_start=keep_range.start,
                        range_end=keep_range.end,
                        output_offset=output_cursor - keep_range.start,
                    ),
                )
            )
        output_cursor += keep_duration
    return remapped


def remap_segments_to_time_range(
    segments: list[TranscriptSegment],
    start_sec: float,
    end_sec: float,
) -> list[SubtitleSegment]:
    remapped: list[SubtitleSegment] = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        overlap_start = max(segment.start, start_sec)
        overlap_end = min(segment.end, end_sec)
        if overlap_end <= overlap_start:
            continue
        remapped.append(
            SubtitleSegment(
                start=round(overlap_start - start_sec, 3),
                end=round(overlap_end - start_sec, 3),
                text=text,
                words=_remap_words_to_range(
                    segment.words,
                    range_start=start_sec,
                    range_end=end_sec,
                    output_offset=-start_sec,
                ),
            )
        )
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


def write_vtt(path: Path, segments: list[SubtitleSegment]) -> None:
    blocks = ["WEBVTT"]
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{_format_vtt_timestamp(segment.start)} --> {_format_vtt_timestamp(segment.end)}",
                    segment.text.strip(),
                ]
            )
        )
    path.write_text("\n\n".join(blocks) + "\n")


def _format_ass_timestamp(value: float) -> str:
    total_cs = int(round(max(value, 0) * 100))
    hours = total_cs // 360_000
    minutes = (total_cs % 360_000) // 6_000
    seconds = (total_cs % 6_000) // 100
    centiseconds = total_cs % 100
    return f"{hours}:{minutes:02}:{seconds:02}.{centiseconds:02}"


def _ass_color(hex_color: str, fallback: str) -> str:
    value = (hex_color or fallback).strip()
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        value = fallback
    red = value[1:3]
    green = value[3:5]
    blue = value[5:7]
    return f"&H00{blue}{green}{red}&".upper()


def _escape_ass_text(value: str) -> str:
    return value.replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def _derived_words_for_segment(segment: SubtitleSegment) -> list[WordTimestamp]:
    usable_words = [
        WordTimestamp(start=max(segment.start, word.start), end=min(segment.end, word.end), word=word.word.strip())
        for word in segment.words
        if word.word.strip() and min(segment.end, word.end) > max(segment.start, word.start)
    ]
    if usable_words:
        return usable_words

    tokens = re.findall(r"\S+", segment.text.strip())
    if not tokens:
        return []
    duration = max(0.2, segment.end - segment.start)
    step = duration / len(tokens)
    return [
        WordTimestamp(
            start=round(segment.start + index * step, 3),
            end=round(segment.start + (index + 1) * step, 3),
            word=token,
        )
        for index, token in enumerate(tokens)
    ]


def _caption_word_groups(
    words: list[WordTimestamp],
    *,
    max_lines: int,
    max_words_per_line: int,
) -> list[list[WordTimestamp]]:
    max_words = max(2, max_lines * max_words_per_line)
    max_chars = max(22, max_lines * 24)
    groups: list[list[WordTimestamp]] = []
    current: list[WordTimestamp] = []

    for word in words:
        text = word.word.strip()
        if not text:
            continue
        current_chars = len(" ".join(item.word for item in current))
        would_exceed_words = len(current) >= max_words
        would_exceed_chars = current_chars + len(text) + 1 > max_chars
        has_pause = bool(current and word.start - current[-1].end > 0.65)
        too_long = bool(current and word.end - current[0].start > 3.2)
        if current and (would_exceed_words or would_exceed_chars or has_pause or too_long):
            groups.append(current)
            current = []
        current.append(word)

    if current:
        groups.append(current)
    return groups


def _caption_group_lines(
    group: list[WordTimestamp],
    *,
    active_index: int,
    base_color: str,
    active_color: str,
    max_lines: int,
    max_words_per_line: int,
) -> str:
    if max_lines <= 1 or len(group) <= max_words_per_line:
        split_index = len(group)
    else:
        split_index = min(max_words_per_line, (len(group) + 1) // 2)

    rendered: list[str] = []
    for index, word in enumerate(group):
        token = _escape_ass_text(word.word)
        if index == active_index:
            token = f"{{\\c{active_color}\\b1}}{token}{{\\c{base_color}\\b1}}"
        rendered.append(token)

    if split_index >= len(rendered):
        return " ".join(rendered)
    return " ".join(rendered[:split_index]) + r"\N" + " ".join(rendered[split_index:])


def write_ass_karaoke(
    path: Path,
    segments: list[SubtitleSegment],
    *,
    base_color: str = "#FFFFFF",
    active_word_color: str = "#FFE15D",
    vertical_position: str = "lower",
    max_lines: int = 2,
    max_words_per_line: int = 4,
) -> None:
    base_ass_color = _ass_color(base_color, "#FFFFFF")
    active_ass_color = _ass_color(active_word_color, "#FFE15D")
    outline_color = "&H00080808&"
    margin_v = 420 if vertical_position == "lower_middle" else 300
    max_lines = max(1, min(2, int(max_lines or 2)))
    max_words_per_line = max(2, min(6, int(max_words_per_line or 4)))

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: ShortsDefault,Arial,78,{base_ass_color},{active_ass_color},{outline_color},&H85000000&,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    all_words: list[WordTimestamp] = []
    for segment in segments:
        all_words.extend(_derived_words_for_segment(segment))
    all_words = sorted(
        [word for word in all_words if word.word.strip() and word.end > word.start],
        key=lambda word: (word.start, word.end),
    )

    if not all_words:
        for segment in segments:
            text = _escape_ass_text(segment.text)
            if text and segment.end > segment.start:
                lines.append(
                    f"Dialogue: 0,{_format_ass_timestamp(segment.start)},{_format_ass_timestamp(segment.end)},ShortsDefault,,0,0,0,,{{\\an2\\b1}}{text}"
                )
        path.write_text("\n".join(lines) + "\n")
        return

    for group in _caption_word_groups(
        all_words,
        max_lines=max_lines,
        max_words_per_line=max_words_per_line,
    ):
        group_start = group[0].start
        group_end = max(group[-1].end, group_start + 0.2)
        for index, word in enumerate(group):
            event_start = max(group_start, word.start)
            event_end_target = group[index + 1].start if index < len(group) - 1 else group_end
            if event_end_target <= event_start:
                event_end_target = word.end
            event_end = max(event_start + 0.08, min(group_end, event_end_target))
            text = _caption_group_lines(
                group,
                active_index=index,
                base_color=base_ass_color,
                active_color=active_ass_color,
                max_lines=max_lines,
                max_words_per_line=max_words_per_line,
            )
            lines.append(
                f"Dialogue: 0,{_format_ass_timestamp(event_start)},{_format_ass_timestamp(event_end)},ShortsDefault,,0,0,0,,{{\\an2\\b1}}{text}"
            )

    path.write_text("\n".join(lines) + "\n")


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


def _subtitle_filter(captions_path: Path) -> str:
    if captions_path.suffix.lower() == ".ass":
        return f"subtitles={captions_path.as_posix()}"
    return (
        f"subtitles={captions_path.as_posix()}:"
        "force_style='FontName=Arial,FontSize=30,Bold=1,PrimaryColour=&H00FFFFFF&,"
        "OutlineColour=&H00080808&,BorderStyle=1,Outline=5,Shadow=2,"
        "Alignment=2,MarginV=300'"
    )


def _clamped_blur_sigma(blur_intensity: float) -> float:
    return round(max(0.0, min(float(blur_intensity or 0), 80.0)), 2)


def _vertical_filter_chain(
    video_input: str,
    probe: dict[str, Any],
    *,
    blur_intensity: float,
) -> tuple[list[str], str]:
    width = float(probe.get("width") or 0)
    height = float(probe.get("height") or 0)
    aspect_ratio = width / height if width > 0 and height > 0 else 16 / 9
    blur_sigma = _clamped_blur_sigma(blur_intensity)

    if aspect_ratio >= 0.75:
        return (
            [
                f"{video_input}scale=1080:1920:force_original_aspect_ratio=increase,"
                "crop=1080:1920,setsar=1[basev]"
            ],
            "[basev]",
        )

    return (
        [
            f"{video_input}split=2[fgsrc][bgsrc]",
            "[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,"
            f"crop=1080:1920,gblur=sigma={blur_sigma},eq=brightness=-0.08[bgv]",
            "[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fgv]",
            "[bgv][fgv]overlay=(W-w)/2:(H-h)/2[basev]",
        ],
        "[basev]",
    )


def _center_blur_fill_filter_chain(video_input: str, *, blur_intensity: float) -> tuple[list[str], str]:
    blur_sigma = _clamped_blur_sigma(blur_intensity)
    return (
        [
            f"{video_input}split=2[fgsrc][bgsrc]",
            "[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,"
            f"crop=1080:1920,gblur=sigma={blur_sigma},eq=brightness=-0.10:saturation=0.88,setsar=1[bgv]",
            "[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fgv]",
            "[bgv][fgv]overlay=(W-w)/2:(H-h)/2:format=auto[basev]",
        ],
        "[basev]",
    )


def _write_command_artifact(path: Path | None, args: list[str]) -> None:
    if path is None:
        return
    path.write_text(shlex.join(args) + "\n")


def render_short_clip(
    settings: Settings,
    source_path: Path,
    output_path: Path,
    *,
    start_sec: float,
    end_sec: float,
    captions_path: Path | None,
    probe: dict[str, Any],
    quality_preset: str,
    export_mode: str,
    blur_intensity: float = 30.0,
    command_log_path: Path | None = None,
) -> None:
    if end_sec <= start_sec:
        raise RuntimeError("Candidate export requires end_sec > start_sec.")

    has_video = bool(probe.get("has_video"))
    has_audio = bool(probe.get("has_audio"))
    if not has_video and not has_audio:
        raise RuntimeError("Source file has no renderable audio or video streams.")

    duration = end_sec - start_sec
    filter_parts: list[str] = []
    audio_label = None

    if has_video:
        trimmed_video = f"[0:v]trim=start={start_sec}:end={end_sec},setpts=PTS-STARTPTS,"
        if export_mode == "center_blur_fill":
            chains, video_label = _center_blur_fill_filter_chain(trimmed_video, blur_intensity=blur_intensity)
            filter_parts.extend(chains)
        elif export_mode == "vertical_9_16":
            chains, video_label = _vertical_filter_chain(trimmed_video, probe, blur_intensity=blur_intensity)
            filter_parts.extend(chains)
        else:
            filter_parts.append(f"{trimmed_video}setsar=1[basev]")
            video_label = "[basev]"
    else:
        filter_parts.append(f"color=c=#161616:s=1080x1920:d={duration},format=yuv420p[basev]")
        video_label = "[basev]"

    if has_audio:
        filter_parts.append(f"[0:a]atrim=start={start_sec}:end={end_sec},asetpts=PTS-STARTPTS[basea]")
        audio_label = "[basea]"

    final_video_label = video_label
    if subtitle_file_is_usable(captions_path):
        filter_parts.append(f"{video_label}{_subtitle_filter(captions_path)}[vout]")
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
    _write_command_artifact(command_log_path, args)
    _run(args)


def extract_thumbnail(settings: Settings, video_path: Path, output_path: Path, *, offset_seconds: float = 1.0) -> None:
    _run(
        [
            settings.ffmpeg_binary,
            "-y",
            "-ss",
            str(max(0.0, offset_seconds)),
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(output_path),
        ]
    )


def render_rough_cut(
    settings: Settings,
    source_path: Path,
    output_path: Path,
    keep_ranges: list[EditRange],
    captions_path: Path | None,
    probe: dict[str, Any],
    quality_preset: str,
    command_log_path: Path | None = None,
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
    _write_command_artifact(command_log_path, args)
    _run(args)
