from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import tracing


class TraceLoggingTests(unittest.TestCase):
    def test_job_trace_writes_machine_readable_jsonl_events(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            outputs_dir = Path(temp_dir)
            trace = tracing.JobTrace(outputs_dir)

            trace.emit(
                stage="probe",
                event="completed",
                message="Source duration detected.",
                payload={"duration_seconds": 12.5},
            )
            trace.emit(
                stage="ffmpeg render",
                event="failed",
                message="Render failed.",
                severity="error",
                payload={"exit_code": 1},
            )

            lines = (outputs_dir / "trace.jsonl").read_text().splitlines()
            parsed = [json.loads(line) for line in lines]
            loaded = tracing.read_trace_events(outputs_dir / "trace.jsonl")

        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["stage"], "probe")
        self.assertEqual(parsed[0]["event"], "completed")
        self.assertEqual(parsed[0]["severity"], "info")
        self.assertEqual(parsed[0]["payload"]["duration_seconds"], 12.5)
        self.assertEqual(parsed[1]["severity"], "error")
        self.assertEqual(loaded, parsed)


if __name__ == "__main__":
    unittest.main()
