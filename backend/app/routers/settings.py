import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.db import get_db
from app.schemas import SettingsResponse, SettingsUpdateRequest
from app.services import presets as preset_service
from app.services import repository

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
def get_settings_route(conn: sqlite3.Connection = Depends(get_db)) -> SettingsResponse:
    settings = repository.get_effective_settings(conn, get_settings())
    return SettingsResponse.model_validate(settings)


@router.put("", response_model=SettingsResponse)
def update_settings_route(
    payload: SettingsUpdateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> SettingsResponse:
    config = get_settings()
    update_payload = payload.model_dump(exclude_none=True)
    if "default_preset" in update_payload and not preset_service.get_preset(config, update_payload["default_preset"]):
        raise HTTPException(status_code=400, detail="Unknown default preset.")
    settings = repository.update_settings(conn, config, update_payload)
    return SettingsResponse.model_validate(settings)

