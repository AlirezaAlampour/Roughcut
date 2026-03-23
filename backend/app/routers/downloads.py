import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.db import get_db
from app.services import repository, storage

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("/projects/{project_id}/{file_id}")
def download_file(
    project_id: str,
    file_id: str,
    conn: sqlite3.Connection = Depends(get_db),
) -> FileResponse:
    file_item = repository.get_file(conn, project_id, file_id)
    if file_item is None:
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        path = storage.resolve_project_relative_path(get_settings(), project_id, file_item["relative_path"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="File is missing on disk.")
    return FileResponse(path=path, filename=file_item["name"], media_type=file_item["mime_type"])

