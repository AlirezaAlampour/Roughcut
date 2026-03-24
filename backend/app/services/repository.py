from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
from typing import Any
import uuid

from app.config import Settings
from app.schemas import JobResult


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_loads(payload: str | None) -> Any:
    if not payload:
        return {}
    return json.loads(payload)


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload)


def _status_summary_for_project(conn: sqlite3.Connection, project_id: str) -> dict[str, Any]:
    upload_count = conn.execute(
        "SELECT COUNT(*) FROM files WHERE project_id = ? AND kind = 'upload'",
        (project_id,),
    ).fetchone()[0]
    output_count = conn.execute(
        "SELECT COUNT(*) FROM files WHERE project_id = ? AND kind = 'output'",
        (project_id,),
    ).fetchone()[0]
    queued_jobs = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE project_id = ? AND status = 'queued'",
        (project_id,),
    ).fetchone()[0]
    running_jobs = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE project_id = ? AND status = 'running'",
        (project_id,),
    ).fetchone()[0]
    last_job = conn.execute(
        """
        SELECT status
        FROM jobs
        WHERE project_id = ?
        ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
        LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    return {
        "upload_count": upload_count,
        "output_count": output_count,
        "queued_jobs": queued_jobs,
        "running_jobs": running_jobs,
        "last_job_status": last_job["status"] if last_job else None,
    }


def _serialize_file(row: sqlite3.Row) -> dict[str, Any]:
    mime_type = row["mime_type"]
    is_playable = bool(mime_type and (mime_type.startswith("video/") or mime_type.startswith("audio/")))
    download_url = f"/downloads/projects/{row['project_id']}/{row['id']}"
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "kind": row["kind"],
        "role": row["role"],
        "name": row["name"],
        "relative_path": row["relative_path"],
        "media_type": row["media_type"],
        "mime_type": mime_type,
        "size_bytes": row["size_bytes"],
        "duration_seconds": row["duration_seconds"],
        "width": row["width"],
        "height": row["height"],
        "metadata": _json_loads(row["metadata_json"]) if row["metadata_json"] else {},
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "download_url": download_url,
        "preview_url": download_url if is_playable else None,
        "is_playable": is_playable,
    }


def _serialize_job(row: sqlite3.Row) -> dict[str, Any]:
    payload = _json_loads(row["payload_json"]) if row["payload_json"] else {}
    result_payload = _json_loads(row["result_json"]) if row["result_json"] else None
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "source_file_id": row["source_file_id"],
        "input_type": payload.get("input_type"),
        "job_mode": payload.get("job_mode"),
        "kind": row["kind"],
        "status": row["status"],
        "preset_id": row["preset_id"],
        "aggressiveness": row["aggressiveness"],
        "captions_enabled": bool(row["captions_enabled"]),
        "generate_shorts": bool(row["generate_shorts"]),
        "user_notes": row["user_notes"],
        "current_step": row["current_step"],
        "progress_message": row["progress_message"],
        "progress_percent": row["progress_percent"],
        "error_message": row["error_message"],
        "payload": payload,
        "result": JobResult.model_validate(result_payload) if result_payload else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


def _touch_project(conn: sqlite3.Connection, project_id: str) -> None:
    conn.execute(
        "UPDATE projects SET updated_at = ? WHERE id = ?",
        (utc_now(), project_id),
    )


def list_projects(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC").fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "status_summary": _status_summary_for_project(conn, row["id"]),
        }
        for row in rows
    ]


def get_project(conn: sqlite3.Connection, project_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "status_summary": _status_summary_for_project(conn, row["id"]),
    }


def create_project(conn: sqlite3.Connection, name: str) -> dict[str, Any]:
    now = utc_now()
    project_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (project_id, name, now, now),
    )
    return get_project(conn, project_id)  # type: ignore[return-value]


def rename_project(conn: sqlite3.Connection, project_id: str, name: str) -> dict[str, Any] | None:
    conn.execute("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", (name, utc_now(), project_id))
    return get_project(conn, project_id)


def delete_project(conn: sqlite3.Connection, project_id: str) -> None:
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


def list_project_files(conn: sqlite3.Connection, project_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()
    return [_serialize_file(row) for row in rows]


def get_file(conn: sqlite3.Connection, project_id: str, file_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM files WHERE project_id = ? AND id = ?",
        (project_id, file_id),
    ).fetchone()
    return _serialize_file(row) if row else None


def create_file(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    kind: str,
    role: str,
    name: str,
    relative_path: str,
    media_type: str,
    mime_type: str | None,
    size_bytes: int,
    duration_seconds: float | None,
    width: int | None,
    height: int | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    file_id = uuid.uuid4().hex
    conn.execute(
        """
        INSERT INTO files (
            id, project_id, kind, role, name, relative_path, media_type, mime_type,
            size_bytes, duration_seconds, width, height, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            file_id,
            project_id,
            kind,
            role,
            name,
            relative_path,
            media_type,
            mime_type,
            size_bytes,
            duration_seconds,
            width,
            height,
            _json_dumps(metadata or {}),
            now,
            now,
        ),
    )
    _touch_project(conn, project_id)
    return get_file(conn, project_id, file_id)  # type: ignore[return-value]


def rename_file(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    file_id: str,
    new_name: str,
    new_relative_path: str,
) -> dict[str, Any] | None:
    conn.execute(
        "UPDATE files SET name = ?, relative_path = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        (new_name, new_relative_path, utc_now(), file_id, project_id),
    )
    _touch_project(conn, project_id)
    return get_file(conn, project_id, file_id)


def delete_file(conn: sqlite3.Connection, project_id: str, file_id: str) -> dict[str, Any] | None:
    current = get_file(conn, project_id, file_id)
    if current is None:
        return None
    conn.execute("DELETE FROM files WHERE id = ? AND project_id = ?", (file_id, project_id))
    _touch_project(conn, project_id)
    return current


def file_has_active_jobs(conn: sqlite3.Connection, project_id: str, file_id: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM jobs
        WHERE project_id = ? AND source_file_id = ? AND status IN ('queued', 'running')
        LIMIT 1
        """,
        (project_id, file_id),
    ).fetchone()
    return row is not None


def list_project_jobs(conn: sqlite3.Connection, project_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()
    return [_serialize_job(row) for row in rows]


def get_job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _serialize_job(row) if row else None


def create_job(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    source_file_id: str,
    preset_id: str,
    aggressiveness: str,
    captions_enabled: bool,
    generate_shorts: bool,
    user_notes: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    now = utc_now()
    job_id = uuid.uuid4().hex
    conn.execute(
        """
        INSERT INTO jobs (
            id, project_id, source_file_id, kind, status, preset_id, aggressiveness,
            captions_enabled, generate_shorts, user_notes, current_step, progress_message,
            progress_percent, payload_json, created_at, updated_at
        )
        VALUES (?, ?, ?, 'rough_cut', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            project_id,
            source_file_id,
            preset_id,
            aggressiveness,
            int(captions_enabled),
            int(generate_shorts),
            user_notes,
            "queued",
            "Queued for processing.",
            0,
            _json_dumps(payload),
            now,
            now,
        ),
    )
    _touch_project(conn, project_id)
    return get_job(conn, job_id)  # type: ignore[return-value]


def claim_next_job(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    now = utc_now()
    updated = conn.execute(
        """
        UPDATE jobs
        SET status = 'running',
            current_step = 'starting',
            progress_message = 'Worker picked up the job.',
            progress_percent = 5,
            started_at = ?,
            updated_at = ?
        WHERE id = ? AND status = 'queued'
        """,
        (now, now, row["id"]),
    )
    if updated.rowcount == 0:
        return None
    return get_job(conn, row["id"])


def update_job_progress(
    conn: sqlite3.Connection,
    job_id: str,
    *,
    current_step: str,
    progress_message: str,
    progress_percent: int,
) -> dict[str, Any] | None:
    conn.execute(
        """
        UPDATE jobs
        SET current_step = ?, progress_message = ?, progress_percent = ?, updated_at = ?
        WHERE id = ?
        """,
        (current_step, progress_message, progress_percent, utc_now(), job_id),
    )
    job = get_job(conn, job_id)
    if job:
        _touch_project(conn, job["project_id"])
    return job


def update_job_payload(conn: sqlite3.Connection, job_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    job = get_job(conn, job_id)
    if job is None:
        return None

    payload = dict(job["payload"])
    payload.update(updates)
    conn.execute(
        "UPDATE jobs SET payload_json = ?, updated_at = ? WHERE id = ?",
        (_json_dumps(payload), utc_now(), job_id),
    )
    _touch_project(conn, job["project_id"])
    return get_job(conn, job_id)


def complete_job(conn: sqlite3.Connection, job_id: str, result: dict[str, Any]) -> dict[str, Any] | None:
    now = utc_now()
    conn.execute(
        """
        UPDATE jobs
        SET status = 'completed',
            current_step = 'completed',
            progress_message = 'Rough cut complete.',
            progress_percent = 100,
            result_json = ?,
            finished_at = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (_json_dumps(result), now, now, job_id),
    )
    job = get_job(conn, job_id)
    if job:
        _touch_project(conn, job["project_id"])
    return job


def fail_job(conn: sqlite3.Connection, job_id: str, error_message: str) -> dict[str, Any] | None:
    now = utc_now()
    conn.execute(
        """
        UPDATE jobs
        SET status = 'failed',
            current_step = 'failed',
            progress_message = 'Rough cut failed.',
            error_message = ?,
            finished_at = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (error_message, now, now, job_id),
    )
    job = get_job(conn, job_id)
    if job:
        _touch_project(conn, job["project_id"])
    return job


def cancel_job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
    now = utc_now()
    conn.execute(
        """
        UPDATE jobs
        SET status = 'canceled',
            current_step = 'canceled',
            progress_message = 'Job canceled before processing.',
            finished_at = ?,
            updated_at = ?
        WHERE id = ? AND status = 'queued'
        """,
        (now, now, job_id),
    )
    return get_job(conn, job_id)


def project_manifest_payload(conn: sqlite3.Connection, project_id: str) -> dict[str, Any] | None:
    project = get_project(conn, project_id)
    if project is None:
        return None
    return {
        **project,
        "files": list_project_files(conn, project_id),
        "jobs": list_project_jobs(conn, project_id),
    }


DEFAULT_SETTINGS = (
    "llm_base_url",
    "llm_model",
    "default_preset",
    "cut_aggressiveness",
    "captions_enabled",
    "output_quality_preset",
)


def get_effective_settings(conn: sqlite3.Connection, settings: Settings) -> dict[str, Any]:
    defaults = {
        "llm_base_url": settings.default_llm_base_url,
        "llm_model": settings.default_llm_model,
        "default_preset": settings.default_preset,
        "cut_aggressiveness": settings.default_cut_aggressiveness,
        "captions_enabled": settings.default_captions_enabled,
        "output_quality_preset": settings.default_output_quality_preset,
        "project_storage_root": str(settings.storage_root),
        "transcription_model": settings.whisper_model,
    }
    rows = conn.execute("SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?, ?)", DEFAULT_SETTINGS).fetchall()
    for row in rows:
        defaults[row["key"]] = _json_loads(row["value"])
    return defaults


def update_settings(conn: sqlite3.Connection, settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    for key, value in payload.items():
        if key not in DEFAULT_SETTINGS:
            continue
        conn.execute(
            """
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, _json_dumps(value), now),
        )
    return get_effective_settings(conn, settings)
