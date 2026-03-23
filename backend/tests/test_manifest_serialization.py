from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.db import init_db, connection
from app.schemas import JobResult
from app.services.jobs import _write_json
from app.services import repository, storage
from app.utils.serialization import make_json_safe


class Mode(Enum):
    READY = "ready"


@dataclass
class ExampleArtifact:
    path: Path
    created_at: datetime
    mode: Mode


class ManifestSerializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        root = Path(self.temp_dir.name)
        self.overrides = {
            "VIDEO_AGENT_DATABASE_PATH": str(root / "data" / "app.db"),
            "VIDEO_AGENT_STORAGE_ROOT": str(root / "data" / "projects"),
            "VIDEO_AGENT_CONFIG_ROOT": str(root / "data" / "config"),
            "VIDEO_AGENT_LOGS_ROOT": str(root / "data" / "logs"),
        }
        self.previous_values = {key: os.environ.get(key) for key in self.overrides}
        os.environ.update(self.overrides)
        get_settings.cache_clear()
        init_db()
        self.settings = get_settings()

    def tearDown(self) -> None:
        for key, value in self.previous_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()

    def test_make_json_safe_normalizes_supported_types(self) -> None:
        when = datetime(2026, 3, 23, 12, 30, tzinfo=timezone.utc)
        artifact = ExampleArtifact(path=Path("/tmp/output.mp4"), created_at=when, mode=Mode.READY)
        result = JobResult(output_file_ids=["out-1"], transcript_file_id="tx-1")

        safe = make_json_safe(
            {
                "result": result,
                "artifact": artifact,
                "dates": [date(2026, 3, 23), when],
                "tuple_values": (Path("/tmp/a"), Mode.READY),
            }
        )

        self.assertEqual(safe["result"]["output_file_ids"], ["out-1"])
        self.assertEqual(safe["artifact"]["path"], "/tmp/output.mp4")
        self.assertEqual(safe["artifact"]["created_at"], when.isoformat())
        self.assertEqual(safe["artifact"]["mode"], "ready")
        self.assertEqual(safe["dates"][0], "2026-03-23")
        self.assertEqual(safe["tuple_values"], ["/tmp/a", "ready"])

    def test_sync_project_manifest_serializes_completed_job_result(self) -> None:
        with connection() as conn:
            project = repository.create_project(conn, "Manifest Regression")
            storage.ensure_project_structure(self.settings, project["id"])

            source_file = repository.create_file(
                conn,
                project_id=project["id"],
                kind="upload",
                role="source",
                name="input.mp4",
                relative_path="uploads/input.mp4",
                media_type="video",
                mime_type="video/mp4",
                size_bytes=1024,
                duration_seconds=42.0,
                width=1920,
                height=1080,
                metadata={"duration_seconds": 42.0},
            )

            job = repository.create_job(
                conn,
                project_id=project["id"],
                source_file_id=source_file["id"],
                preset_id="talking_head_clean",
                aggressiveness="balanced",
                captions_enabled=True,
                generate_shorts=False,
                user_notes="Keep pacing tight.",
                payload={
                    "llm_base_url": "http://localhost:11434/v1",
                    "llm_model": "planner-model",
                    "output_quality_preset": "balanced",
                },
            )

            output_file = repository.create_file(
                conn,
                project_id=project["id"],
                kind="output",
                role="render",
                name="rough-cut.mp4",
                relative_path=f"outputs/{job['id']}/rough-cut.mp4",
                media_type="video",
                mime_type="video/mp4",
                size_bytes=2048,
                duration_seconds=30.0,
                width=1920,
                height=1080,
                metadata={"duration_seconds": 30.0},
            )

            result = JobResult(
                output_file_ids=[output_file["id"]],
                transcript_file_id="transcript-1",
                subtitle_file_id="subtitle-1",
                edit_plan_file_id="plan-1",
                log_file_id="log-1",
                notes_for_user=["Render completed cleanly."],
                transcript_preview="Hello world",
                plan={"keep_ranges": [{"start": 0.0, "end": 10.0, "reason": "hook"}]},
            )

            repository.complete_job(conn, job["id"], result.model_dump())
            storage.sync_project_manifest(conn, self.settings, project["id"])

        manifest_path = storage.project_root(self.settings, project["id"]) / "project.json"
        self.assertTrue(manifest_path.exists(), "project.json should be written after manifest sync.")

        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest["id"], project["id"])
        self.assertEqual(manifest["jobs"][0]["status"], "completed")
        self.assertEqual(manifest["jobs"][0]["result"]["output_file_ids"], [output_file["id"]])
        self.assertEqual(manifest["jobs"][0]["result"]["notes_for_user"], ["Render completed cleanly."])

    def test_jobs_write_json_serializes_job_result_payload(self) -> None:
        output_path = Path(self.temp_dir.name) / "result.json"
        result = JobResult(
            output_file_ids=["render-1"],
            transcript_file_id="transcript-1",
            subtitle_file_id="subtitle-1",
            edit_plan_file_id="plan-1",
            log_file_id="log-1",
            notes_for_user=["Render completed cleanly."],
            transcript_preview="Hello world",
            plan={"keep_ranges": [{"start": 0.0, "end": 10.0, "reason": "hook"}]},
        )

        _write_json(
            output_path,
            {
                "result": result,
                "artifact": ExampleArtifact(
                    path=Path("/tmp/output.mp4"),
                    created_at=datetime(2026, 3, 23, 12, 30, tzinfo=timezone.utc),
                    mode=Mode.READY,
                ),
            },
        )

        payload = json.loads(output_path.read_text())
        self.assertEqual(payload["result"]["output_file_ids"], ["render-1"])
        self.assertEqual(payload["artifact"]["path"], "/tmp/output.mp4")
        self.assertEqual(payload["artifact"]["mode"], "ready")


if __name__ == "__main__":
    unittest.main()
