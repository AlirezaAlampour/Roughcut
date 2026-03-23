from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def make_json_safe(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return make_json_safe(value.model_dump(mode="json"))

    if is_dataclass(value) and not isinstance(value, type):
        return make_json_safe(asdict(value))

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Enum):
        return make_json_safe(value.value)

    if isinstance(value, dict):
        return {str(key): make_json_safe(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [make_json_safe(item) for item in value]

    return value

