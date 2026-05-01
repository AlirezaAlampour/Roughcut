from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from app.config import Settings
from app.services import storage
from app.utils.serialization import make_json_safe

TRACE_FILENAME = "trace.jsonl"
TRACE_ARTIFACT_FILENAMES = (
    "planner-prompt.txt",
    "planner-response.json",
    "planner-response.txt",
    "render-command.txt",
)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JobTrace:
    def __init__(self, outputs_dir: Path):
        self.outputs_dir = outputs_dir
        self.path = outputs_dir / TRACE_FILENAME

    def emit(
        self,
        *,
        stage: str,
        event: str,
        message: str,
        severity: str = "info",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        trace_event: dict[str, Any] = {
            "timestamp": utc_timestamp(),
            "stage": stage,
            "event": event,
            "message": message,
            "severity": severity,
        }
        if payload is not None:
            trace_event["payload"] = make_json_safe(payload)

        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as handle:
            handle.write(json.dumps(make_json_safe(trace_event), separators=(",", ":")) + "\n")
        return trace_event


def output_dir_for_job(settings: Settings, job: dict[str, Any]) -> Path:
    root = storage.outputs_root(settings, job["project_id"]) / job["id"]
    if job.get("kind") != "short_export":
        return root

    payload = job.get("payload") or {}
    candidate_payload = payload.get("candidate") if isinstance(payload, dict) else None
    candidate_id = ""
    if isinstance(candidate_payload, dict):
        candidate_id = str(candidate_payload.get("id") or "")
    if not candidate_id:
        candidate_id = str(payload.get("candidate_id") or "") if isinstance(payload, dict) else ""
    if candidate_id:
        return root / candidate_id

    trace_matches = sorted(root.glob(f"*/{TRACE_FILENAME}"))
    if trace_matches:
        return trace_matches[0].parent
    return root


def read_trace_events(trace_path: Path) -> list[dict[str, Any]]:
    if not trace_path.exists():
        return []

    events: list[dict[str, Any]] = []
    for line in trace_path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            events.append(payload)
    return events


def read_trace_artifacts(outputs_dir: Path) -> dict[str, str]:
    artifacts: dict[str, str] = {}
    for filename in TRACE_ARTIFACT_FILENAMES:
        path = outputs_dir / filename
        if path.exists() and path.is_file():
            artifacts[filename] = path.read_text(errors="replace")
    return artifacts
