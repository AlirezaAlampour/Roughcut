import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_db
from app.schemas import JobSummary
from app.services import repository

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobSummary)
def get_job(job_id: str, conn: sqlite3.Connection = Depends(get_db)) -> JobSummary:
    job = repository.get_job(conn, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobSummary.model_validate(job)


@router.post("/{job_id}/cancel", response_model=JobSummary)
def cancel_job(job_id: str, conn: sqlite3.Connection = Depends(get_db)) -> JobSummary:
    job = repository.get_job(conn, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "queued":
        raise HTTPException(status_code=409, detail="Only queued jobs can be canceled in v1.")
    canceled = repository.cancel_job(conn, job_id)
    return JobSummary.model_validate(canceled)

