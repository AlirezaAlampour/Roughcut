from collections.abc import Generator
from contextlib import contextmanager
import sqlite3

from app.config import get_settings

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL,
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    preset_id TEXT NOT NULL,
    aggressiveness TEXT NOT NULL,
    captions_enabled INTEGER NOT NULL,
    generate_shorts INTEGER NOT NULL,
    user_notes TEXT,
    current_step TEXT,
    progress_message TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    payload_json TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_project_kind ON files(project_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at ASC);
"""


def init_db() -> None:
    settings = get_settings()
    settings.ensure_directories()
    with sqlite3.connect(settings.database_path) as conn:
        conn.executescript(SCHEMA_SQL)


@contextmanager
def connection() -> Generator[sqlite3.Connection, None, None]:
    settings = get_settings()
    conn = sqlite3.connect(settings.database_path, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def get_db() -> Generator[sqlite3.Connection, None, None]:
    with connection() as conn:
        yield conn

