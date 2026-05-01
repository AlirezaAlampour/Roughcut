from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Roughcut"
    version: str = "0.1.0"
    api_prefix: str = "/api"

    database_path: Path = Path("/data/app.db")
    storage_root: Path = Path("/data/projects")
    config_root: Path = Path("/data/config")
    logs_root: Path = Path("/data/logs")

    default_llm_base_url: str = ""
    default_llm_model: str = ""
    default_preset: str = "tacdel_builder_story"
    default_cut_aggressiveness: str = "balanced"
    default_captions_enabled: bool = True
    default_output_quality_preset: str = "balanced"
    enable_detailed_planner_logging: bool = True

    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    max_upload_size_mb: int = 8192
    worker_poll_interval_seconds: float = 2.0
    llm_request_timeout_seconds: int = 180

    allowed_upload_extensions: tuple[str, ...] = Field(
        default=(
            ".mp4",
            ".mov",
            ".mkv",
            ".webm",
            ".m4v",
            ".mp3",
            ".wav",
            ".m4a",
            ".aac",
            ".flac",
            ".ogg",
        )
    )

    model_config = SettingsConfigDict(
        env_prefix="VIDEO_AGENT_",
        env_file=".env",
        extra="ignore",
    )

    def ensure_directories(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.config_root.mkdir(parents=True, exist_ok=True)
        self.logs_root.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
