from fastapi import APIRouter

from app.config import get_settings
from app.schemas import PresetsResponse
from app.services import presets

router = APIRouter(prefix="/presets", tags=["presets"])


@router.get("", response_model=PresetsResponse)
def list_presets_route() -> PresetsResponse:
    return PresetsResponse(items=presets.list_presets(get_settings()))

