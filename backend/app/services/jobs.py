from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import traceback

from app.config import Settings
from app.db import connection
from app.schemas import EditPlan, EditRange, JobResult, PresetConfig, SubtitleSegment, TranscriptSegment
from app.services import media, planner, presets, repository, storage, transcription
from app.utils.serialization import make_json_safe


def _log_line(lines: list[str], message: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lines.append(f"{timestamp} {message}")


def _store_generated_file(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    project_id: str,
    relative_path: str,
    role: str,
) -> dict:
    full_path = storage.resolve_project_relative_path(settings, project_id, relative_path)
    media_type, mime_type = storage.classify_path(full_path)
    metadata = {}
    duration = None
    width = None
    height = None
    if media_type in {"video", "audio"}:
        probe = media.probe_media(settings, full_path)
        metadata = probe
        duration = probe.get("duration_seconds")
        width = probe.get("width")
        height = probe.get("height")
    return repository.create_file(
        conn,
        project_id=project_id,
        kind="output",
        role=role,
        name=full_path.name,
        relative_path=relative_path,
        media_type=media_type,
        mime_type=mime_type,
        size_bytes=full_path.stat().st_size,
        duration_seconds=duration,
        width=width,
        height=height,
        metadata=metadata,
    )


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(make_json_safe(payload), indent=2))


def _remove_file_if_exists(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _prepare_transcript_text_file(
    *,
    outputs_dir: Path,
    transcript_segments: list[TranscriptSegment],
    log_lines: list[str],
) -> Path | None:
    transcript_txt_path = outputs_dir / "transcript.txt"
    transcript_content = media.transcript_text_lines(transcript_segments)
    if not transcript_content:
        _remove_file_if_exists(transcript_txt_path)
        _log_line(log_lines, "Transcript artifact empty; skipping transcript.txt output.")
        return None

    transcript_txt_path.write_text(transcript_content)
    if not media.artifact_file_has_content(transcript_txt_path):
        _remove_file_if_exists(transcript_txt_path)
        _log_line(log_lines, "Transcript artifact empty; skipping transcript.txt output.")
        return None

    _log_line(log_lines, "Wrote transcript.txt.")
    return transcript_txt_path


def _prepare_subtitle_file(
    *,
    outputs_dir: Path,
    transcript_segments: list[TranscriptSegment],
    keep_ranges: list[EditRange],
    captions_enabled: bool,
    log_lines: list[str],
) -> tuple[list[SubtitleSegment], Path | None]:
    srt_path = outputs_dir / "captions.srt"

    if not transcript_segments:
        _remove_file_if_exists(srt_path)
        _log_line(log_lines, "Captions artifact empty; skipping captions.srt output.")
        if captions_enabled:
            _log_line(log_lines, "Captions requested but transcript/subtitle output was empty; rendering without subtitles.")
        else:
            _log_line(log_lines, "Transcript contained no segments. Skipping subtitle file generation.")
        return [], None

    subtitle_segments = media.remap_segments_to_keep_ranges(transcript_segments, keep_ranges)
    if not subtitle_segments:
        _remove_file_if_exists(srt_path)
        _log_line(log_lines, "Captions artifact empty; skipping captions.srt output.")
        if captions_enabled:
            _log_line(log_lines, "Captions requested but transcript/subtitle output was empty; rendering without subtitles.")
        else:
            _log_line(log_lines, "No subtitle segments were available; skipping subtitle file generation.")
        return [], None

    try:
        media.write_srt(srt_path, subtitle_segments)
    except Exception as exc:
        _remove_file_if_exists(srt_path)
        if captions_enabled:
            _log_line(log_lines, f"Captions artifact generation failed ({exc}); skipping captions.srt output.")
            _log_line(log_lines, "Captions requested but transcript/subtitle output was empty; rendering without subtitles.")
        else:
            _log_line(log_lines, f"Subtitle file generation failed ({exc}); continuing without subtitle export.")
        return subtitle_segments, None

    if not media.artifact_file_has_content(srt_path):
        _remove_file_if_exists(srt_path)
        _log_line(log_lines, "Captions artifact empty; skipping captions.srt output.")
        if captions_enabled:
            _log_line(log_lines, "Captions requested but transcript/subtitle output was empty; rendering without subtitles.")
        else:
            _log_line(log_lines, "Subtitle file generation produced an empty captions.srt file; skipping subtitle export.")
        return subtitle_segments, None

    _log_line(log_lines, f"Wrote {len(subtitle_segments)} subtitle segments to captions.srt.")
    return subtitle_segments, srt_path


def _select_captions_path(*, captions_enabled: bool, subtitle_path: Path | None, log_lines: list[str]) -> Path | None:
    if not captions_enabled:
        if subtitle_path is not None:
            _log_line(log_lines, "Captions disabled for this job; rendering without burned-in captions.")
        return None

    if subtitle_path is None:
        return None

    if not media.subtitle_file_is_usable(subtitle_path):
        _log_line(log_lines, "Captions artifact empty; skipping captions.srt output.")
        _log_line(log_lines, "Captions requested but transcript/subtitle output was empty; rendering without subtitles.")
        return None

    _log_line(log_lines, "Rendering with burned-in captions.")
    return subtitle_path


def process_next_job(settings: Settings) -> bool:
    with connection() as conn:
        job = repository.claim_next_job(conn)
        if job is None:
            return False
        job_id = job["id"]

    process_job(settings, job_id)
    return True


def process_job(settings: Settings, job_id: str) -> None:
    log_lines: list[str] = []
    project_id = ""
    outputs_dir: Path | None = None
    log_relative_path: str | None = None

    try:
        with connection() as conn:
            job = repository.get_job(conn, job_id)
            if job is None:
                return
            project_id = job["project_id"]
            source_file = repository.get_file(conn, project_id, job["source_file_id"])
            if source_file is None:
                raise RuntimeError("Source media file is missing.")
            payload = job["payload"]
            preset = presets.get_preset(settings, job["preset_id"])
            if preset is None:
                raise RuntimeError(f"Preset '{job['preset_id']}' was not found.")

        storage.ensure_project_structure(settings, project_id)
        outputs_dir = storage.outputs_root(settings, project_id) / job_id
        outputs_dir.mkdir(parents=True, exist_ok=True)
        log_relative_path = f"outputs/{job_id}/job.log"
        source_path = storage.resolve_project_relative_path(settings, project_id, source_file["relative_path"])

        _log_line(log_lines, f"Starting job {job_id} for source {source_file['name']}.")
        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="probing",
                progress_message="Inspecting the source media.",
                progress_percent=10,
            )

        probe = media.probe_media(settings, source_path)
        duration = probe.get("duration_seconds")
        if not duration:
            raise RuntimeError("Could not determine media duration from ffprobe.")
        _log_line(log_lines, f"Source duration detected: {duration:.2f}s.")

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="transcribing",
                progress_message="Creating transcript with faster-whisper.",
                progress_percent=25,
            )
        transcript = transcription.transcribe_media(settings, source_path)
        _log_line(log_lines, f"Transcribed {len(transcript.segments)} segments.")
        if not transcript.segments:
            _log_line(log_lines, "Transcription produced zero segments.")
            _log_line(
                log_lines,
                "Transcript contained no segments. The planner may still return keep ranges from source duration and preset guidance.",
            )

        transcript_json_path = outputs_dir / "transcript.json"
        _write_json(transcript_json_path, transcript.model_dump())
        transcript_txt_path = _prepare_transcript_text_file(
            outputs_dir=outputs_dir,
            transcript_segments=transcript.segments,
            log_lines=log_lines,
        )

        with connection() as conn:
            transcript_json_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"outputs/{job_id}/transcript.json",
                role="transcript_json",
            )
            transcript_txt_file = None
            if transcript_txt_path is not None:
                transcript_txt_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"outputs/{job_id}/transcript.txt",
                    role="transcript_text",
                )
            storage.sync_project_manifest(conn, settings, project_id)

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="planning",
                progress_message=(
                    "No speech detected; using a conservative fallback plan."
                    if not transcript.segments
                    else "Generating a structured edit plan with the local model."
                ),
                progress_percent=50,
            )

        planner_messages: list[str] = []
        plan = planner.create_edit_plan(
            settings=settings,
            llm_base_url=payload.get("llm_base_url", ""),
            llm_model=payload.get("llm_model", ""),
            source_filename=source_file["name"],
            source_duration=float(duration),
            preset=preset,
            transcript=transcript,
            aggressiveness=job["aggressiveness"],
            captions_enabled=job["captions_enabled"],
            generate_shorts=job["generate_shorts"],
            user_notes=job["user_notes"],
            log_messages=planner_messages,
        )
        for message in planner_messages:
            _log_line(log_lines, message)
        _log_line(log_lines, f"Planning produced {len(plan.keep_ranges)} keep ranges.")

        plan_path = outputs_dir / "edit-plan.json"
        _write_json(plan_path, plan.model_dump())

        with connection() as conn:
            plan_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"outputs/{job_id}/edit-plan.json",
                role="edit_plan",
            )
            storage.sync_project_manifest(conn, settings, project_id)

        _, srt_path = _prepare_subtitle_file(
            outputs_dir=outputs_dir,
            transcript_segments=transcript.segments,
            keep_ranges=plan.keep_ranges,
            captions_enabled=plan.caption_strategy.enabled,
            log_lines=log_lines,
        )
        srt_file = None
        if srt_path is not None:
            with connection() as conn:
                srt_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"outputs/{job_id}/captions.srt",
                    role="subtitle",
                )
                storage.sync_project_manifest(conn, settings, project_id)

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="rendering",
                progress_message="Rendering the rough cut with ffmpeg.",
                progress_percent=75,
            )

        output_path = outputs_dir / "rough-cut.mp4"
        captions_path = _select_captions_path(
            captions_enabled=plan.caption_strategy.enabled,
            subtitle_path=srt_path,
            log_lines=log_lines,
        )
        if captions_path is None:
            _log_line(log_lines, "Subtitle burn-in skipped.")
            _log_line(log_lines, "Rendering rough cut without burned-in captions.")
        media.render_rough_cut(
            settings,
            source_path=source_path,
            output_path=output_path,
            keep_ranges=plan.keep_ranges,
            captions_path=captions_path,
            probe=probe,
            quality_preset=payload.get("output_quality_preset", "balanced"),
        )
        _log_line(log_lines, "Render completed successfully.")

        log_path = outputs_dir / "job.log"
        log_path.write_text("\n".join(log_lines) + "\n")

        with connection() as conn:
            video_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"outputs/{job_id}/rough-cut.mp4",
                role="render",
            )
            log_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=log_relative_path,
                role="log",
            )
            output_file_ids = [video_file["id"], transcript_json_file["id"], plan_file["id"]]
            if transcript_txt_file is not None:
                output_file_ids.append(transcript_txt_file["id"])
            if srt_file is not None:
                output_file_ids.append(srt_file["id"])
            output_file_ids.append(log_file["id"])
            result = JobResult(
                output_file_ids=output_file_ids,
                transcript_file_id=transcript_txt_file["id"] if transcript_txt_file is not None else None,
                subtitle_file_id=srt_file["id"] if srt_file is not None else None,
                edit_plan_file_id=plan_file["id"],
                log_file_id=log_file["id"],
                notes_for_user=plan.notes_for_user,
                transcript_preview=media.transcript_text(transcript.segments)[:1000],
                plan=plan.model_dump(),
            )
            repository.complete_job(conn, job_id, result.model_dump())
            storage.sync_project_manifest(conn, settings, project_id)
    except Exception as exc:
        message = str(exc).strip() or "Unknown failure."
        if outputs_dir is not None:
            outputs_dir.mkdir(parents=True, exist_ok=True)
            _log_line(log_lines, f"Failure: {message}")
            _log_line(log_lines, traceback.format_exc())
            log_path = outputs_dir / "job.log"
            log_path.write_text("\n".join(log_lines) + "\n")

        with connection() as conn:
            repository.fail_job(conn, job_id, message)
            if project_id and log_relative_path:
                try:
                    if repository.get_project(conn, project_id) is not None:
                        _store_generated_file(
                            conn,
                            settings,
                            project_id=project_id,
                            relative_path=log_relative_path,
                            role="log",
                        )
                except Exception:
                    pass
                storage.sync_project_manifest(conn, settings, project_id)
