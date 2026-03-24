from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class HealthResponse(BaseModel):
    status: str
    app_name: str
    version: str
    storage_root: str
    database_path: str


class MessageResponse(BaseModel):
    message: str


class ProjectStatusSummary(BaseModel):
    upload_count: int = 0
    output_count: int = 0
    queued_jobs: int = 0
    running_jobs: int = 0
    last_job_status: str | None = None


class FileItem(BaseModel):
    id: str
    project_id: str
    kind: Literal["upload", "output"]
    role: str
    name: str
    relative_path: str
    media_type: str
    mime_type: str | None = None
    size_bytes: int
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    download_url: str
    preview_url: str | None = None
    is_playable: bool = False


class JobResult(BaseModel):
    output_file_ids: list[str] = Field(default_factory=list)
    transcript_file_id: str | None = None
    subtitle_file_id: str | None = None
    edit_plan_file_id: str | None = None
    log_file_id: str | None = None
    notes_for_user: list[str] = Field(default_factory=list)
    transcript_preview: str | None = None
    plan: dict[str, Any] | None = None


class JobSummary(BaseModel):
    id: str
    project_id: str
    source_file_id: str
    input_type: Literal["video", "audio-only"] | None = None
    job_mode: Literal["video", "audio-only"] | None = None
    kind: str
    status: Literal["queued", "running", "completed", "failed", "canceled"]
    preset_id: str
    aggressiveness: Literal["conservative", "balanced", "aggressive"]
    captions_enabled: bool
    generate_shorts: bool
    user_notes: str | None = None
    current_step: str | None = None
    progress_message: str | None = None
    progress_percent: int = 0
    error_message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    result: JobResult | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    finished_at: str | None = None


class ProjectSummary(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    status_summary: ProjectStatusSummary


class ProjectDetail(ProjectSummary):
    files: list[FileItem] = Field(default_factory=list)
    jobs: list[JobSummary] = Field(default_factory=list)


class ProjectCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class ProjectUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class FileRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class UploadResponse(BaseModel):
    files: list[FileItem]
    errors: list[str] = Field(default_factory=list)


class SettingsResponse(BaseModel):
    llm_base_url: str
    llm_model: str
    default_preset: str
    cut_aggressiveness: Literal["conservative", "balanced", "aggressive"]
    captions_enabled: bool
    output_quality_preset: Literal["draft", "balanced", "quality"]
    project_storage_root: str
    transcription_model: str


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    llm_base_url: str | None = None
    llm_model: str | None = None
    default_preset: str | None = None
    cut_aggressiveness: Literal["conservative", "balanced", "aggressive"] | None = None
    captions_enabled: bool | None = None
    output_quality_preset: Literal["draft", "balanced", "quality"] | None = None


class PresetConfig(BaseModel):
    id: str
    name: str
    description: str
    silence_threshold_db: int
    minimum_silence_duration: float
    filler_removal_aggressiveness: Literal["low", "medium", "high"]
    cut_aggressiveness: Literal["conservative", "balanced", "aggressive"]
    caption_style: str
    zoom_rule: str
    shorts_behavior: str
    cta_preservation: str
    planner_hint: str


class PresetsResponse(BaseModel):
    items: list[PresetConfig]


class JobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file_id: str
    preset_id: str
    aggressiveness: Literal["conservative", "balanced", "aggressive"] = "balanced"
    captions_enabled: bool = True
    generate_shorts: bool = False
    user_notes: str | None = Field(default=None, max_length=600)


class WordTimestamp(BaseModel):
    start: float
    end: float
    word: str


class TranscriptSegment(BaseModel):
    index: int
    start: float
    end: float
    text: str
    words: list[WordTimestamp] = Field(default_factory=list)


class EditRange(BaseModel):
    start: float
    end: float
    reason: str

    @model_validator(mode="after")
    def validate_range(self) -> "EditRange":
        if self.end <= self.start:
            raise ValueError("Edit ranges must have end > start.")
        return self


class CaptionStrategy(BaseModel):
    enabled: bool = True
    style: str = "clean_minimal"


class SubtitleSegment(BaseModel):
    start: float
    end: float
    text: str


class ZoomEvent(BaseModel):
    start: float
    end: float
    scale: float = 1.08
    reason: str | None = None


class ShortsCandidate(BaseModel):
    title: str
    start: float
    end: float
    hook: str | None = None


class EditPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file: str
    preset: str
    transcript_summary: str
    keep_ranges: list[EditRange]
    cut_ranges: list[EditRange] = Field(default_factory=list)
    silence_removed_summary: str = ""
    filler_removed_summary: str = ""
    caption_strategy: CaptionStrategy = Field(default_factory=CaptionStrategy)
    subtitle_segments: list[SubtitleSegment] = Field(default_factory=list)
    zoom_events: list[ZoomEvent] = Field(default_factory=list)
    shorts_candidates: list[ShortsCandidate] = Field(default_factory=list)
    notes_for_user: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_keep_ranges(self) -> "EditPlan":
        if not self.keep_ranges:
            raise ValueError("Edit plan must include at least one keep range.")
        return self


class TranscriptArtifact(BaseModel):
    language: str | None = None
    language_probability: float | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)
