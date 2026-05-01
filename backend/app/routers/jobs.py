import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.db import get_db
from app.schemas import JobSummary, JobTraceResponse
from app.services import repository, tracing

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobSummary)
def get_job(job_id: str, conn: sqlite3.Connection = Depends(get_db)) -> JobSummary:
    job = repository.get_job(conn, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobSummary.model_validate(job)


@router.get("/{job_id}/trace", response_model=JobTraceResponse)
def get_job_trace(job_id: str, conn: sqlite3.Connection = Depends(get_db)) -> JobTraceResponse:
    job = repository.get_job(conn, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    outputs_dir = tracing.output_dir_for_job(get_settings(), job)
    return JobTraceResponse.model_validate(
        {
            "job_id": job_id,
            "events": tracing.read_trace_events(outputs_dir / tracing.TRACE_FILENAME),
            "artifacts": tracing.read_trace_artifacts(outputs_dir),
        }
    )


@router.post("/{job_id}/cancel", response_model=JobSummary)
def cancel_job(job_id: str, conn: sqlite3.Connection = Depends(get_db)) -> JobSummary:
    job = repository.get_job(conn, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "queued":
        raise HTTPException(status_code=409, detail="Only queued jobs can be canceled in v1.")
    canceled = repository.cancel_job(conn, job_id)
    return JobSummary.model_validate(canceled)
