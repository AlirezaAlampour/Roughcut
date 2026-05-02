from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import traceback

from app.config import Settings
from app.db import connection
from app.schemas import (
    CandidateClip,
    CandidateManifest,
    EditRange,
    JobResult,
    PresetConfig,
    SubtitleSegment,
    TranscriptSegment,
)
from app.services import candidates, media, planner, presets, repository, storage, tracing, transcription
from app.utils.serialization import make_json_safe


def _log_line(lines: list[str], message: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lines.append(f"{timestamp} {message}")


def _log_and_trace(
    lines: list[str],
    trace: tracing.JobTrace | None,
    *,
    stage: str,
    event: str,
    message: str,
    severity: str = "info",
    payload: dict | None = None,
) -> None:
    _log_line(lines, message)
    if trace is not None:
        trace.emit(stage=stage, event=event, message=message, severity=severity, payload=payload)


def _store_generated_file(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    project_id: str,
    relative_path: str,
    role: str,
    metadata_extra: dict | None = None,
) -> dict:
    full_path = storage.resolve_project_relative_path(settings, project_id, relative_path)
    media_type, mime_type = storage.classify_path(full_path)
    metadata = dict(metadata_extra or {})
    duration = None
    width = None
    height = None
    if media_type in {"video", "audio"}:
        probe = media.probe_media(settings, full_path)
        metadata = {**probe, **metadata}
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


def _store_generated_file_if_exists(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    project_id: str,
    relative_path: str,
    role: str,
    metadata_extra: dict | None = None,
) -> dict | None:
    full_path = storage.resolve_project_relative_path(settings, project_id, relative_path)
    if not media.artifact_file_has_content(full_path):
        return None
    return _store_generated_file(
        conn,
        settings,
        project_id=project_id,
        relative_path=relative_path,
        role=role,
        metadata_extra=metadata_extra,
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


def _fail_job_with_log(
    *,
    settings: Settings,
    job_id: str,
    project_id: str,
    outputs_dir: Path | None,
    log_relative_path: str | None,
    trace_relative_path: str | None = None,
    log_lines: list[str],
    message: str,
) -> None:
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
                    if trace_relative_path:
                        _store_generated_file_if_exists(
                            conn,
                            settings,
                            project_id=project_id,
                            relative_path=trace_relative_path,
                            role="trace_jsonl",
                        )
            except Exception:
                pass
            storage.sync_project_manifest(conn, settings, project_id)


def _load_job_source_and_preset(settings: Settings, job_id: str) -> tuple[dict, dict, PresetConfig]:
    with connection() as conn:
        job = repository.get_job(conn, job_id)
        if job is None:
            raise RuntimeError("Job not found.")
        source_file = repository.get_file(conn, job["project_id"], job["source_file_id"])
        if source_file is None:
            raise RuntimeError("Source media file is missing.")
        preset = presets.get_preset(settings, job["preset_id"])
        if preset is None:
            raise RuntimeError(f"Preset '{job['preset_id']}' was not found.")
    return job, source_file, preset


def process_job(settings: Settings, job_id: str) -> None:
    with connection() as conn:
        job = repository.get_job(conn, job_id)
    if job is None:
        return

    if job["kind"] == "short_export":
        _process_short_export_job(settings, job_id)
        return

    _process_shorts_candidate_generation_job(settings, job_id)


def _process_shorts_candidate_generation_job(settings: Settings, job_id: str) -> None:
    log_lines: list[str] = []
    project_id = ""
    outputs_dir: Path | None = None
    log_relative_path: str | None = None
    trace_relative_path: str | None = None
    trace: tracing.JobTrace | None = None

    try:
        job, source_file, preset = _load_job_source_and_preset(settings, job_id)
        project_id = job["project_id"]
        payload = job["payload"]

        storage.ensure_project_structure(settings, project_id)
        outputs_dir = storage.outputs_root(settings, project_id) / job_id
        outputs_dir.mkdir(parents=True, exist_ok=True)
        log_relative_path = f"outputs/{job_id}/job.log"
        trace_relative_path = f"outputs/{job_id}/trace.jsonl"
        trace = tracing.JobTrace(outputs_dir)
        source_path = storage.resolve_project_relative_path(settings, project_id, source_file["relative_path"])

        _log_and_trace(
            log_lines,
            trace,
            stage="job",
            event="started",
            message=f"Starting shorts candidate generation job {job_id} for source {source_file['name']}.",
            payload={
                "job_id": job_id,
                "source_file": source_file["name"],
                "preset_id": job["preset_id"],
            },
        )
        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="probing",
                progress_message="Inspecting the source media.",
                progress_percent=10,
            )

        _log_and_trace(
            log_lines,
            trace,
            stage="probe",
            event="started",
            message="Inspecting source media with ffprobe.",
            payload={"source_path": source_file["relative_path"]},
        )
        probe = media.probe_media(settings, source_path)
        duration = probe.get("duration_seconds")
        if not duration:
            raise RuntimeError("Could not determine media duration from ffprobe.")
        job_mode = media.source_mode_from_probe(probe)
        input_type = job_mode
        with connection() as conn:
            repository.update_job_payload(
                conn,
                job_id,
                {
                    "input_type": input_type,
                    "job_mode": job_mode,
                },
            )
        _log_and_trace(
            log_lines,
            trace,
            stage="probe",
            event="completed",
            message=f"Source duration detected: {duration:.2f}s.",
            payload=probe,
        )
        if job_mode == "audio-only":
            _log_and_trace(
                log_lines,
                trace,
                stage="probe",
                event="source_mode",
                message="Source detected as audio-only. Candidate metadata can be generated, but vertical video export will use a neutral background.",
                payload={"job_mode": job_mode},
            )
        else:
            _log_and_trace(
                log_lines,
                trace,
                stage="probe",
                event="source_mode",
                message="Source detected as video. Using video mode.",
                payload={"job_mode": job_mode},
            )

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="transcribing",
                progress_message="Creating transcript with faster-whisper.",
                progress_percent=25,
            )
        _log_and_trace(
            log_lines,
            trace,
            stage="transcription",
            event="started",
            message="Creating transcript with faster-whisper.",
            payload={"model": settings.whisper_model},
        )
        transcript = transcription.transcribe_media(settings, source_path)
        word_count = sum(len(segment.words) for segment in transcript.segments)
        _log_and_trace(
            log_lines,
            trace,
            stage="transcription",
            event="completed",
            message=f"Transcribed {len(transcript.segments)} segments.",
            payload={
                "segment_count": len(transcript.segments),
                "word_count": word_count,
                "language": transcript.language,
                "language_probability": transcript.language_probability,
            },
        )
        if not transcript.segments:
            _log_and_trace(
                log_lines,
                trace,
                stage="transcription",
                event="empty",
                message="Transcription produced zero segments.",
                severity="warning",
            )
            _log_and_trace(
                log_lines,
                trace,
                stage="planner scoring",
                event="skipped",
                message="Transcript contained no segments. Roughcut will not ask the planner to score shorts candidates.",
                severity="warning",
            )

        transcript_json_path = outputs_dir / "transcript.json"
        _write_json(transcript_json_path, transcript.model_dump())
        trace.emit(
            stage="artifact write",
            event="transcript_json_written",
            message="Wrote transcript.json.",
            payload={"relative_path": f"outputs/{job_id}/transcript.json"},
        )
        transcript_txt_path = _prepare_transcript_text_file(
            outputs_dir=outputs_dir,
            transcript_segments=transcript.segments,
            log_lines=log_lines,
        )
        if transcript_txt_path is not None:
            trace.emit(
                stage="artifact write",
                event="transcript_text_written",
                message="Wrote transcript.txt.",
                payload={"relative_path": f"outputs/{job_id}/transcript.txt"},
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
                current_step="segmenting",
                progress_message="Splitting the transcript into shorts candidate windows.",
                progress_percent=50,
            )

        _log_and_trace(
            log_lines,
            trace,
            stage="segmentation",
            event="started",
            message="Splitting the transcript into shorts candidate windows.",
            payload={
                "target_clip_min_sec": preset.target_clip_min_sec,
                "target_clip_max_sec": preset.target_clip_max_sec,
                "max_candidates": preset.max_candidates,
            },
        )
        candidate_windows = candidates.segment_transcript_into_candidates(
            transcript,
            preset=preset,
            source_duration=float(duration),
            aggressiveness=job["aggressiveness"],
        )
        _log_and_trace(
            log_lines,
            trace,
            stage="segmentation",
            event="completed",
            message=f"Deterministic pre-segmentation produced {len(candidate_windows)} candidate windows.",
            payload={"candidate_count": len(candidate_windows)},
        )

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="scoring",
                progress_message=(
                    "No candidate windows found; writing an empty candidate manifest."
                    if not candidate_windows
                    else "Scoring shorts candidates with the planner model."
                ),
                progress_percent=68,
            )

        planner_messages: list[str] = []
        if candidate_windows:
            _log_and_trace(
                log_lines,
                trace,
                stage="planner scoring",
                event="started",
                message="Scoring shorts candidates with the planner model.",
                payload={
                    "candidate_count": len(candidate_windows),
                    "llm_model": payload.get("llm_model", ""),
                    "detailed_planner_logging": settings.enable_detailed_planner_logging,
                },
            )
        else:
            trace.emit(
                stage="planner scoring",
                event="skipped",
                message="No candidate windows found; skipping planner scoring.",
                severity="warning",
            )
        scoring_outcome = (
            planner.score_short_candidates(
                settings=settings,
                llm_base_url=payload.get("llm_base_url", ""),
                llm_model=payload.get("llm_model", ""),
                source_filename=source_file["name"],
                source_duration=float(duration),
                preset=preset,
                candidates=candidate_windows,
                user_notes=job["user_notes"],
                log_messages=planner_messages,
                artifact_dir=outputs_dir if settings.enable_detailed_planner_logging else None,
            )
            if candidate_windows
            else planner.CandidateScoringOutcome(candidates=[])
        )
        scored_candidates = scoring_outcome.candidates
        for message in planner_messages:
            _log_and_trace(
                log_lines,
                trace,
                stage="planner scoring",
                event="message",
                message=message,
            )
        for event in scoring_outcome.trace_events:
            _log_and_trace(
                log_lines,
                trace,
                stage=event.stage,
                event=event.event,
                message=event.message,
                severity=event.severity,
                payload=event.payload,
            )
        if candidate_windows:
            trace.emit(
                stage="planner scoring",
                event="completed",
                message=f"Planner scoring returned {len(scored_candidates)} ranked candidates.",
                payload={
                    "candidate_count": len(scored_candidates),
                    "planner_prompt_artifact": "planner-prompt.txt"
                    if settings.enable_detailed_planner_logging and (outputs_dir / "planner-prompt.txt").exists()
                    else None,
                    "planner_response_artifact": (
                        "planner-response.json"
                        if (outputs_dir / "planner-response.json").exists()
                        else ("planner-response.txt" if (outputs_dir / "planner-response.txt").exists() else None)
                    ),
                },
            )

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="writing",
                progress_message="Writing the ranked shorts candidate manifest.",
                progress_percent=88,
            )

        notes_for_user: list[str] = []
        if not transcript.segments:
            notes_for_user.append("No speech was detected, so Roughcut could not generate shorts candidates.")
        elif not scored_candidates:
            notes_for_user.append("No usable shorts candidate windows were found in the transcript.")
        else:
            notes_for_user.extend(scoring_outcome.notes_for_user)
            notes_for_user.append(f"Generated and ranked {len(scored_candidates)} shorts candidates.")

        manifest = CandidateManifest(
            source_file=source_file["name"],
            preset=preset.name,
            source_duration=float(duration),
            target_clip_min_sec=float(preset.target_clip_min_sec),
            target_clip_max_sec=float(preset.target_clip_max_sec),
            candidates=scored_candidates,
            notes_for_user=notes_for_user,
        )
        manifest_path = outputs_dir / "candidates.json"
        _write_json(manifest_path, manifest.model_dump())
        _log_and_trace(
            log_lines,
            trace,
            stage="artifact write",
            event="candidate_manifest_written",
            message="Wrote candidates.json.",
            payload={"relative_path": f"outputs/{job_id}/candidates.json"},
        )

        log_path = outputs_dir / "job.log"
        trace.emit(
            stage="artifact write",
            event="job_log_written",
            message="Wrote job.log.",
            payload={"relative_path": log_relative_path},
        )
        log_path.write_text("\n".join(log_lines) + "\n")

        with connection() as conn:
            candidate_manifest_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"outputs/{job_id}/candidates.json",
                role="candidate_manifest",
            )
            log_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=log_relative_path,
                role="log",
            )
            trace_file = _store_generated_file_if_exists(
                conn,
                settings,
                project_id=project_id,
                relative_path=trace_relative_path,
                role="trace_jsonl",
            )
            planner_prompt_file = _store_generated_file_if_exists(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"outputs/{job_id}/planner-prompt.txt",
                role="planner_prompt",
            )
            planner_response_file = _store_generated_file_if_exists(
                conn,
                settings,
                project_id=project_id,
                relative_path=(
                    f"outputs/{job_id}/planner-response.json"
                    if (outputs_dir / "planner-response.json").exists()
                    else f"outputs/{job_id}/planner-response.txt"
                ),
                role="planner_response",
            )
            output_file_ids = [transcript_json_file["id"], candidate_manifest_file["id"]]
            if transcript_txt_file is not None:
                output_file_ids.append(transcript_txt_file["id"])
            output_file_ids.append(log_file["id"])
            if trace_file is not None:
                output_file_ids.append(trace_file["id"])
            if planner_prompt_file is not None:
                output_file_ids.append(planner_prompt_file["id"])
            if planner_response_file is not None:
                output_file_ids.append(planner_response_file["id"])
            result = JobResult(
                output_file_ids=output_file_ids,
                transcript_file_id=transcript_txt_file["id"] if transcript_txt_file is not None else None,
                candidate_manifest_file_id=candidate_manifest_file["id"],
                log_file_id=log_file["id"],
                trace_file_id=trace_file["id"] if trace_file is not None else None,
                planner_prompt_file_id=planner_prompt_file["id"] if planner_prompt_file is not None else None,
                planner_response_file_id=planner_response_file["id"] if planner_response_file is not None else None,
                notes_for_user=notes_for_user,
                transcript_preview=media.transcript_text(transcript.segments)[:1000],
                candidates=scored_candidates,
                candidate_count=len(scored_candidates),
            )
            repository.complete_job(conn, job_id, result.model_dump())
            storage.sync_project_manifest(conn, settings, project_id)
    except Exception as exc:
        message = str(exc).strip() or "Unknown failure."
        if outputs_dir is not None:
            trace = trace or tracing.JobTrace(outputs_dir)
            trace.emit(
                stage="job",
                event="failed",
                message=message,
                severity="error",
                payload={"traceback": traceback.format_exc()},
            )
        _fail_job_with_log(
            settings=settings,
            job_id=job_id,
            project_id=project_id,
            outputs_dir=outputs_dir,
            log_relative_path=log_relative_path,
            trace_relative_path=trace_relative_path,
            log_lines=log_lines,
            message=message,
        )


def _write_candidate_subtitles(
    *,
    candidate: CandidateClip,
    outputs_dir: Path,
    preset: PresetConfig,
    log_lines: list[str],
) -> tuple[Path | None, Path | None, Path | None]:
    if not candidate.subtitle_segments:
        _log_line(log_lines, "Candidate has no subtitle segments; skipping SRT/VTT generation.")
        return None, None, None

    srt_path = outputs_dir / "captions.srt"
    vtt_path = outputs_dir / "captions.vtt"
    ass_path = outputs_dir / "captions.ass"
    media.write_srt(srt_path, candidate.subtitle_segments)
    media.write_vtt(vtt_path, candidate.subtitle_segments)
    media.write_ass_karaoke(
        ass_path,
        candidate.subtitle_segments,
        base_color=preset.caption_base_color,
        active_word_color=preset.caption_active_word_color,
        vertical_position=preset.caption_vertical_position,
        max_lines=preset.caption_max_lines,
        max_words_per_line=preset.caption_max_words_per_line,
    )
    _log_line(log_lines, f"Wrote {len(candidate.subtitle_segments)} subtitle segments to SRT, VTT, and ASS.")
    return srt_path, vtt_path, ass_path


def _process_short_export_job(settings: Settings, job_id: str) -> None:
    log_lines: list[str] = []
    project_id = ""
    outputs_dir: Path | None = None
    log_relative_path: str | None = None
    trace_relative_path: str | None = None
    trace: tracing.JobTrace | None = None

    try:
        job, source_file, preset = _load_job_source_and_preset(settings, job_id)
        project_id = job["project_id"]
        payload = job["payload"]
        candidate = CandidateClip.model_validate(payload.get("candidate"))
        source_candidate_job_id = str(payload.get("source_candidate_job_id") or "")

        storage.ensure_project_structure(settings, project_id)
        outputs_dir = storage.outputs_root(settings, project_id) / job_id / candidate.id
        outputs_dir.mkdir(parents=True, exist_ok=True)
        log_relative_path = f"outputs/{job_id}/{candidate.id}/job.log"
        trace_relative_path = f"outputs/{job_id}/{candidate.id}/trace.jsonl"
        trace = tracing.JobTrace(outputs_dir)
        source_path = storage.resolve_project_relative_path(settings, project_id, source_file["relative_path"])

        _log_and_trace(
            log_lines,
            trace,
            stage="job",
            event="started",
            message=f"Starting short export job {job_id} for candidate {candidate.id}.",
            payload={
                "job_id": job_id,
                "candidate_id": candidate.id,
                "source_candidate_job_id": source_candidate_job_id,
            },
        )
        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="probing",
                progress_message="Inspecting source media for candidate export.",
                progress_percent=10,
            )

        _log_and_trace(
            log_lines,
            trace,
            stage="probe",
            event="started",
            message="Inspecting source media for candidate export.",
            payload={"source_path": source_file["relative_path"]},
        )
        probe = media.probe_media(settings, source_path)
        duration = probe.get("duration_seconds")
        if not duration:
            raise RuntimeError("Could not determine media duration from ffprobe.")
        job_mode = media.source_mode_from_probe(probe)
        with connection() as conn:
            repository.update_job_payload(
                conn,
                job_id,
                {
                    "input_type": job_mode,
                    "job_mode": job_mode,
                },
            )
        _log_and_trace(
            log_lines,
            trace,
            stage="probe",
            event="completed",
            message=f"Source duration detected: {duration:.2f}s.",
            payload=probe,
        )

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="captions",
                progress_message="Preparing short-form captions.",
                progress_percent=30,
            )

        export_mode = payload.get("export_mode") or preset.export_mode
        blur_intensity = float(payload.get("blur_intensity", preset.blur_intensity))
        _log_and_trace(
            log_lines,
            trace,
            stage="export prep",
            event="started",
            message="Preparing candidate export artifacts.",
            payload={
                "candidate_id": candidate.id,
                "start_sec": candidate.start_sec,
                "end_sec": candidate.end_sec,
                "caption_segment_count": len(candidate.subtitle_segments),
                "export_mode": export_mode,
                "blur_intensity": blur_intensity,
            },
        )

        candidate_json_path = outputs_dir / "candidate.json"
        _write_json(
            candidate_json_path,
            {
                "candidate": candidate.model_dump(),
                "source_candidate_job_id": source_candidate_job_id,
                "source_file": source_file["name"],
                "export_mode": export_mode,
                "blur_intensity": blur_intensity,
            },
        )
        trace.emit(
            stage="artifact write",
            event="candidate_json_written",
            message="Wrote candidate.json.",
            payload={"relative_path": f"outputs/{job_id}/{candidate.id}/candidate.json"},
        )
        srt_path, vtt_path, ass_path = _write_candidate_subtitles(
            candidate=candidate,
            outputs_dir=outputs_dir,
            preset=preset,
            log_lines=log_lines,
        )
        if srt_path is not None:
            trace.emit(
                stage="artifact write",
                event="captions_written",
                message="Wrote captions.srt, captions.vtt, and captions.ass.",
                payload={
                    "srt": f"outputs/{job_id}/{candidate.id}/captions.srt",
                    "vtt": f"outputs/{job_id}/{candidate.id}/captions.vtt",
                    "ass": f"outputs/{job_id}/{candidate.id}/captions.ass",
                    "word_count": sum(len(segment.words) for segment in candidate.subtitle_segments),
                },
            )
        _log_and_trace(
            log_lines,
            trace,
            stage="export prep",
            event="completed",
            message="Prepared candidate export artifacts.",
            payload={"captions_ass": ass_path is not None},
        )

        with connection() as conn:
            repository.update_job_progress(
                conn,
                job_id,
                current_step="rendering",
                progress_message="Rendering a vertical short with ffmpeg.",
                progress_percent=65,
            )

        clip_path = outputs_dir / "clip.mp4"
        captions_path = _select_captions_path(
            captions_enabled=bool(payload.get("captions_enabled", job["captions_enabled"])),
            subtitle_path=ass_path or srt_path,
            log_lines=log_lines,
        )
        if captions_path is None:
            _log_and_trace(
                log_lines,
                trace,
                stage="ffmpeg render",
                event="captions_disabled",
                message="Rendering candidate without burned-in captions.",
            )
        render_command_path = outputs_dir / "render-command.txt"
        _log_and_trace(
            log_lines,
            trace,
            stage="ffmpeg render",
            event="started",
            message="Rendering a vertical short with ffmpeg.",
            payload={
                "output_path": f"outputs/{job_id}/{candidate.id}/clip.mp4",
                "export_mode": export_mode,
                "captions_path": captions_path.name if captions_path else None,
            },
        )
        media.render_short_clip(
            settings,
            source_path=source_path,
            output_path=clip_path,
            start_sec=candidate.start_sec,
            end_sec=candidate.end_sec,
            captions_path=captions_path,
            probe=probe,
            quality_preset=payload.get("output_quality_preset", "balanced"),
            export_mode=export_mode,
            blur_intensity=blur_intensity,
            hook_text=media.hook_overlay_text(candidate.hook_text, candidate.title),
            command_log_path=render_command_path,
        )
        _log_and_trace(
            log_lines,
            trace,
            stage="ffmpeg render",
            event="completed",
            message="Candidate render completed successfully.",
            payload={
                "clip_path": f"outputs/{job_id}/{candidate.id}/clip.mp4",
                "render_command_artifact": f"outputs/{job_id}/{candidate.id}/render-command.txt",
            },
        )

        thumbnail_path = outputs_dir / "thumbnail.jpg"
        try:
            media.extract_thumbnail(settings, clip_path, thumbnail_path)
            _log_and_trace(
                log_lines,
                trace,
                stage="artifact write",
                event="thumbnail_written",
                message="Extracted thumbnail.jpg.",
                payload={"relative_path": f"outputs/{job_id}/{candidate.id}/thumbnail.jpg"},
            )
        except Exception as exc:
            thumbnail_path = None
            _log_and_trace(
                log_lines,
                trace,
                stage="artifact write",
                event="thumbnail_skipped",
                message=f"Thumbnail extraction skipped ({exc}).",
                severity="warning",
            )

        log_path = outputs_dir / "job.log"
        trace.emit(
            stage="artifact write",
            event="job_log_written",
            message="Wrote job.log.",
            payload={"relative_path": log_relative_path},
        )
        log_path.write_text("\n".join(log_lines) + "\n")

        relative_prefix = f"outputs/{job_id}/{candidate.id}"
        file_metadata = {
            "candidate_id": candidate.id,
            "source_candidate_job_id": source_candidate_job_id,
            "candidate_start_sec": candidate.start_sec,
            "candidate_end_sec": candidate.end_sec,
        }
        with connection() as conn:
            clip_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"{relative_prefix}/clip.mp4",
                role="candidate_clip",
                metadata_extra=file_metadata,
            )
            candidate_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"{relative_prefix}/candidate.json",
                role="candidate_json",
                metadata_extra=file_metadata,
            )
            srt_file = None
            if srt_path is not None:
                srt_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"{relative_prefix}/captions.srt",
                    role="candidate_captions_srt",
                    metadata_extra=file_metadata,
                )
            vtt_file = None
            if vtt_path is not None:
                vtt_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"{relative_prefix}/captions.vtt",
                    role="candidate_captions_vtt",
                    metadata_extra=file_metadata,
                )
            ass_file = None
            if ass_path is not None:
                ass_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"{relative_prefix}/captions.ass",
                    role="candidate_captions_ass",
                    metadata_extra=file_metadata,
                )
            render_command_file = _store_generated_file_if_exists(
                conn,
                settings,
                project_id=project_id,
                relative_path=f"{relative_prefix}/render-command.txt",
                role="render_command",
                metadata_extra=file_metadata,
            )
            thumbnail_file = None
            if thumbnail_path is not None:
                thumbnail_file = _store_generated_file(
                    conn,
                    settings,
                    project_id=project_id,
                    relative_path=f"{relative_prefix}/thumbnail.jpg",
                    role="candidate_thumbnail",
                    metadata_extra=file_metadata,
                )
            log_file = _store_generated_file(
                conn,
                settings,
                project_id=project_id,
                relative_path=log_relative_path,
                role="log",
                metadata_extra=file_metadata,
            )
            trace_file = _store_generated_file_if_exists(
                conn,
                settings,
                project_id=project_id,
                relative_path=trace_relative_path,
                role="trace_jsonl",
                metadata_extra=file_metadata,
            )

            output_file_ids = [clip_file["id"], candidate_file["id"]]
            if srt_file is not None:
                output_file_ids.append(srt_file["id"])
            if vtt_file is not None:
                output_file_ids.append(vtt_file["id"])
            if ass_file is not None:
                output_file_ids.append(ass_file["id"])
            if render_command_file is not None:
                output_file_ids.append(render_command_file["id"])
            if thumbnail_file is not None:
                output_file_ids.append(thumbnail_file["id"])
            output_file_ids.append(log_file["id"])
            if trace_file is not None:
                output_file_ids.append(trace_file["id"])

            result = JobResult(
                output_file_ids=output_file_ids,
                subtitle_file_id=srt_file["id"] if srt_file is not None else None,
                candidate_manifest_file_id=candidate_file["id"],
                log_file_id=log_file["id"],
                trace_file_id=trace_file["id"] if trace_file is not None else None,
                render_command_file_id=render_command_file["id"] if render_command_file is not None else None,
                notes_for_user=[f"Exported {candidate.id} as a vertical short."],
                candidates=[candidate],
                candidate_count=1,
                exported_candidate_id=candidate.id,
                export={
                    "clip_file_id": clip_file["id"],
                    "srt_file_id": srt_file["id"] if srt_file is not None else None,
                    "vtt_file_id": vtt_file["id"] if vtt_file is not None else None,
                    "ass_file_id": ass_file["id"] if ass_file is not None else None,
                    "thumbnail_file_id": thumbnail_file["id"] if thumbnail_file is not None else None,
                    "trace_file_id": trace_file["id"] if trace_file is not None else None,
                    "render_command_file_id": render_command_file["id"] if render_command_file is not None else None,
                    "source_candidate_job_id": source_candidate_job_id,
                },
            )
            repository.complete_job(conn, job_id, result.model_dump())
            storage.sync_project_manifest(conn, settings, project_id)
    except Exception as exc:
        message = str(exc).strip() or "Unknown failure."
        if outputs_dir is not None:
            trace = trace or tracing.JobTrace(outputs_dir)
            trace.emit(
                stage="job",
                event="failed",
                message=message,
                severity="error",
                payload={"traceback": traceback.format_exc()},
            )
        _fail_job_with_log(
            settings=settings,
            job_id=job_id,
            project_id=project_id,
            outputs_dir=outputs_dir,
            log_relative_path=log_relative_path,
            trace_relative_path=trace_relative_path,
            log_lines=log_lines,
            message=message,
        )
