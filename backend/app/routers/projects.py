from __future__ import annotations

from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import get_settings
from app.db import get_db
from app.schemas import (
    FileItem,
    FileRenameRequest,
    JobCreateRequest,
    JobSummary,
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
    UploadResponse,
)
from app.services import media, presets, repository, storage

router = APIRouter(prefix="/projects", tags=["projects"])


async def _save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    written = 0
    with destination.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise ValueError("Upload exceeded the configured maximum file size.")
            handle.write(chunk)
    await upload.close()
    return written


@router.get("", response_model=list[ProjectSummary])
def list_projects(conn: sqlite3.Connection = Depends(get_db)) -> list[ProjectSummary]:
    return [ProjectSummary.model_validate(item) for item in repository.list_projects(conn)]


@router.post("", response_model=ProjectSummary)
def create_project(
    payload: ProjectCreateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> ProjectSummary:
    project = repository.create_project(conn, payload.name)
    storage.ensure_project_structure(get_settings(), project["id"])
    storage.sync_project_manifest(conn, get_settings(), project["id"])
    return ProjectSummary.model_validate(project)


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ProjectDetail:
    project = repository.get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectDetail.model_validate(
        {
            **project,
            "files": repository.list_project_files(conn, project_id),
            "jobs": repository.list_project_jobs(conn, project_id),
        }
    )


@router.patch("/{project_id}", response_model=ProjectSummary)
def rename_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> ProjectSummary:
    project = repository.rename_project(conn, project_id, payload.name)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    storage.sync_project_manifest(conn, get_settings(), project_id)
    return ProjectSummary.model_validate(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    project = repository.get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    repository.delete_project(conn, project_id)
    storage.delete_project_tree(get_settings(), project_id)


@router.get("/{project_id}/files", response_model=list[FileItem])
def list_project_files(project_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[FileItem]:
    if repository.get_project(conn, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return [FileItem.model_validate(item) for item in repository.list_project_files(conn, project_id)]


@router.post("/{project_id}/uploads", response_model=UploadResponse)
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
    conn: sqlite3.Connection = Depends(get_db),
) -> UploadResponse:
    settings = get_settings()
    project = repository.get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one file to upload.")

    storage.ensure_project_structure(settings, project_id)
    uploaded: list[dict] = []
    errors: list[str] = []
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    for upload in files:
        destination: Path | None = None
        try:
            original_name = storage.sanitize_filename(upload.filename or "upload.bin")
            storage.validate_upload_extension(settings, original_name)
            destination_dir = storage.uploads_root(settings, project_id)
            filename = storage.unique_filename(destination_dir, original_name)
            destination = destination_dir / filename
            size_bytes = await _save_upload(upload, destination, max_bytes)
            probe = media.probe_media(settings, destination)
            media_type, mime_type = storage.classify_path(destination, upload.content_type)
            if media_type not in {"video", "audio"}:
                raise ValueError("Only video and audio uploads are supported.")
            item = repository.create_file(
                conn,
                project_id=project_id,
                kind="upload",
                role="source",
                name=filename,
                relative_path=f"uploads/{filename}",
                media_type=media_type,
                mime_type=mime_type,
                size_bytes=size_bytes,
                duration_seconds=probe.get("duration_seconds"),
                width=probe.get("width"),
                height=probe.get("height"),
                metadata=probe,
            )
            uploaded.append(item)
        except Exception as exc:
            errors.append(f"{upload.filename or 'upload'}: {exc}")
            if destination is not None and destination.exists():
                destination.unlink(missing_ok=True)

    if not uploaded:
        raise HTTPException(status_code=400, detail="; ".join(errors) if errors else "Upload failed.")

    storage.sync_project_manifest(conn, settings, project_id)
    return UploadResponse(files=[FileItem.model_validate(item) for item in uploaded], errors=errors)


@router.patch("/{project_id}/files/{file_id}", response_model=FileItem)
def rename_file(
    project_id: str,
    file_id: str,
    payload: FileRenameRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> FileItem:
    settings = get_settings()
    file_item = repository.get_file(conn, project_id, file_id)
    if file_item is None:
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        new_name = storage.sanitize_filename(payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    original_path = storage.resolve_project_relative_path(settings, project_id, file_item["relative_path"])
    incoming_suffix = Path(new_name).suffix
    if incoming_suffix and incoming_suffix.lower() != original_path.suffix.lower():
        raise HTTPException(status_code=400, detail="File extension cannot be changed during rename.")
    target_dir = original_path.parent
    suffix = original_path.suffix if not incoming_suffix else ""
    candidate_name = storage.unique_filename(target_dir, f"{new_name}{suffix}")
    new_path = target_dir / candidate_name
    original_path.rename(new_path)
    updated = repository.rename_file(
        conn,
        project_id=project_id,
        file_id=file_id,
        new_name=candidate_name,
        new_relative_path=str(Path(file_item["relative_path"]).parent / candidate_name),
    )
    storage.sync_project_manifest(conn, settings, project_id)
    return FileItem.model_validate(updated)


@router.delete("/{project_id}/files/{file_id}", status_code=204)
def delete_file(project_id: str, file_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    settings = get_settings()
    file_item = repository.get_file(conn, project_id, file_id)
    if file_item is None:
        raise HTTPException(status_code=404, detail="File not found.")
    if repository.file_has_active_jobs(conn, project_id, file_id):
        raise HTTPException(status_code=409, detail="This file is in use by an active job.")
    path = storage.resolve_project_relative_path(settings, project_id, file_item["relative_path"])
    repository.delete_file(conn, project_id, file_id)
    path.unlink(missing_ok=True)
    storage.sync_project_manifest(conn, settings, project_id)


@router.get("/{project_id}/jobs", response_model=list[JobSummary])
def list_project_jobs(project_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[JobSummary]:
    if repository.get_project(conn, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return [JobSummary.model_validate(item) for item in repository.list_project_jobs(conn, project_id)]


@router.post("/{project_id}/jobs", response_model=JobSummary)
def create_job(
    project_id: str,
    payload: JobCreateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> JobSummary:
    project = repository.get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    source_file = repository.get_file(conn, project_id, payload.source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Source file not found.")
    if source_file["kind"] != "upload":
        raise HTTPException(status_code=400, detail="Only uploaded source media can be used for rough-cut jobs.")

    config = get_settings()
    preset = presets.get_preset(config, payload.preset_id)
    if preset is None:
        raise HTTPException(status_code=400, detail="Unknown preset.")

    effective_settings = repository.get_effective_settings(conn, config)
    if not effective_settings["llm_base_url"] or not effective_settings["llm_model"]:
        raise HTTPException(
            status_code=400,
            detail="Set the local LLM base URL and planner model in Settings before generating.",
        )

    job = repository.create_job(
        conn,
        project_id=project_id,
        source_file_id=payload.source_file_id,
        preset_id=payload.preset_id,
        aggressiveness=payload.aggressiveness,
        captions_enabled=payload.captions_enabled,
        generate_shorts=payload.generate_shorts,
        user_notes=payload.user_notes,
        payload={
            "llm_base_url": effective_settings["llm_base_url"],
            "llm_model": effective_settings["llm_model"],
            "output_quality_preset": effective_settings["output_quality_preset"],
            "preset": preset.model_dump(),
        },
    )
    storage.sync_project_manifest(conn, config, project_id)
    return JobSummary.model_validate(job)
