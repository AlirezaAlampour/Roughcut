export type Aggressiveness = "conservative" | "balanced" | "aggressive";
export type OutputQuality = "draft" | "balanced" | "quality";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface ProjectStatusSummary {
  upload_count: number;
  output_count: number;
  queued_jobs: number;
  running_jobs: number;
  last_job_status: JobStatus | null;
}

export interface FileItem {
  id: string;
  project_id: string;
  kind: "upload" | "output";
  role: string;
  name: string;
  relative_path: string;
  media_type: string;
  mime_type: string | null;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  download_url: string;
  preview_url: string | null;
  is_playable: boolean;
}

export interface JobResult {
  output_file_ids: string[];
  transcript_file_id: string | null;
  subtitle_file_id: string | null;
  edit_plan_file_id: string | null;
  log_file_id: string | null;
  notes_for_user: string[];
  transcript_preview: string | null;
  plan: Record<string, unknown> | null;
}

export interface JobSummary {
  id: string;
  project_id: string;
  source_file_id: string;
  kind: string;
  status: JobStatus;
  preset_id: string;
  aggressiveness: Aggressiveness;
  captions_enabled: boolean;
  generate_shorts: boolean;
  user_notes: string | null;
  current_step: string | null;
  progress_message: string | null;
  progress_percent: number;
  error_message: string | null;
  payload: Record<string, unknown>;
  result: JobResult | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status_summary: ProjectStatusSummary;
}

export interface ProjectDetail extends ProjectSummary {
  files: FileItem[];
  jobs: JobSummary[];
}

export interface UploadResponse {
  files: FileItem[];
  errors: string[];
}

export interface SettingsResponse {
  llm_base_url: string;
  llm_model: string;
  default_preset: string;
  cut_aggressiveness: Aggressiveness;
  captions_enabled: boolean;
  output_quality_preset: OutputQuality;
  project_storage_root: string;
  transcription_model: string;
}

export interface SettingsUpdateRequest {
  llm_base_url?: string;
  llm_model?: string;
  default_preset?: string;
  cut_aggressiveness?: Aggressiveness;
  captions_enabled?: boolean;
  output_quality_preset?: OutputQuality;
}

export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  silence_threshold_db: number;
  minimum_silence_duration: number;
  filler_removal_aggressiveness: "low" | "medium" | "high";
  cut_aggressiveness: Aggressiveness;
  caption_style: string;
  zoom_rule: string;
  shorts_behavior: string;
  cta_preservation: string;
  planner_hint: string;
}

export interface PresetsResponse {
  items: PresetConfig[];
}

export interface JobCreateRequest {
  source_file_id: string;
  preset_id: string;
  aggressiveness: Aggressiveness;
  captions_enabled: boolean;
  generate_shorts: boolean;
  user_notes?: string;
}

