from __future__ import annotations

import json
import mimetypes
from pathlib import Path
import re
import shutil
import sqlite3

from app.config import Settings
from app.utils.serialization import make_json_safe

INVALID_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]+")


def project_root(settings: Settings, project_id: str) -> Path:
    return settings.storage_root / project_id


def uploads_root(settings: Settings, project_id: str) -> Path:
    return project_root(settings, project_id) / "uploads"


def outputs_root(settings: Settings, project_id: str) -> Path:
    return project_root(settings, project_id) / "outputs"


def temp_root(settings: Settings, project_id: str) -> Path:
    return project_root(settings, project_id) / "temp"


def ensure_project_structure(settings: Settings, project_id: str) -> None:
    uploads_root(settings, project_id).mkdir(parents=True, exist_ok=True)
    outputs_root(settings, project_id).mkdir(parents=True, exist_ok=True)
    temp_root(settings, project_id).mkdir(parents=True, exist_ok=True)


def delete_project_tree(settings: Settings, project_id: str) -> None:
    shutil.rmtree(project_root(settings, project_id), ignore_errors=True)


def sanitize_filename(name: str) -> str:
    basename = Path(name).name.strip()
    basename = basename.replace("..", ".")
    basename = INVALID_FILENAME_CHARS.sub("", basename)
    basename = re.sub(r"\s+", " ", basename).strip()
    if basename in {"", ".", ".."}:
        raise ValueError("Invalid filename.")
    return basename


def unique_filename(directory: Path, preferred_name: str) -> str:
    candidate = preferred_name
    stem = Path(preferred_name).stem
    suffix = Path(preferred_name).suffix
    counter = 2
    while (directory / candidate).exists():
        candidate = f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def validate_upload_extension(settings: Settings, filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in settings.allowed_upload_extensions:
        raise ValueError(f"Unsupported file type: {suffix or 'unknown'}")


def classify_path(path: Path, mime_type: str | None = None) -> tuple[str, str | None]:
    guessed_mime = mime_type or mimetypes.guess_type(path.name)[0]
    if guessed_mime and guessed_mime.startswith("video/"):
        return "video", guessed_mime
    if guessed_mime and guessed_mime.startswith("audio/"):
        return "audio", guessed_mime
    if guessed_mime and guessed_mime.startswith("image/"):
        return "image", guessed_mime
    if path.suffix.lower() in {".json", ".jsonl"}:
        return "json", guessed_mime or "application/json"
    if path.suffix.lower() in {".txt", ".log"}:
        return "text", guessed_mime or "text/plain"
    if path.suffix.lower() in {".ass", ".srt", ".vtt"}:
        return "subtitle", guessed_mime or "application/x-subrip"
    return "binary", guessed_mime


def resolve_project_relative_path(settings: Settings, project_id: str, relative_path: str) -> Path:
    root = project_root(settings, project_id).resolve()
    candidate = (root / relative_path).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Illegal file path.")
    return candidate


def file_download_url(project_id: str, file_id: str) -> str:
    return f"/downloads/projects/{project_id}/{file_id}"


def write_project_manifest(settings: Settings, project_id: str, payload: dict) -> None:
    ensure_project_structure(settings, project_id)
    manifest_path = project_root(settings, project_id) / "project.json"
    manifest_path.write_text(json.dumps(make_json_safe(payload), indent=2))


def sync_project_manifest(conn: sqlite3.Connection, settings: Settings, project_id: str) -> None:
    from app.services import repository

    payload = repository.project_manifest_payload(conn, project_id)
    if payload is not None:
        write_project_manifest(settings, project_id, payload)
