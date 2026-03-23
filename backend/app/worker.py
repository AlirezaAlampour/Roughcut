from __future__ import annotations

import time

from app.config import get_settings
from app.db import init_db
from app.services import jobs


def main() -> None:
    settings = get_settings()
    settings.ensure_directories()
    init_db()
    while True:
        processed = jobs.process_next_job(settings)
        if not processed:
            time.sleep(settings.worker_poll_interval_seconds)


if __name__ == "__main__":
    main()
