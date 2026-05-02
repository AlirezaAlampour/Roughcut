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
  candidate_manifest_file_id: string | null;
  log_file_id: string | null;
  trace_file_id: string | null;
  planner_prompt_file_id: string | null;
  planner_response_file_id: string | null;
  render_command_file_id: string | null;
  notes_for_user: string[];
  transcript_preview: string | null;
  plan: Record<string, unknown> | null;
  candidates: CandidateClip[];
  candidate_count: number;
  exported_candidate_id: string | null;
  export: Record<string, unknown> | null;
}

export interface JobSummary {
  id: string;
  project_id: string;
  source_file_id: string;
  input_type: "video" | "audio-only" | null;
  job_mode: "video" | "audio-only" | null;
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

export type ClipStylePresetId = "clean" | "bold" | "aggressive";

export type ClipHookTextAlignment = "left" | "center" | "right";

export interface ClipHookStyleOverrides {
  hook_text?: string;
  font_size?: number;
  top_offset?: number;
  box_width?: number;
  box_padding?: number;
  max_lines?: number;
  text_alignment?: ClipHookTextAlignment;
}

export interface ClipCaptionStyleOverrides {
  base_color?: string;
  active_word_color?: string;
  font_size?: number;
  vertical_position?: "lower" | "lower_middle";
  bottom_offset?: number;
  max_lines?: number;
  outline_strength?: number;
  shadow_strength?: number;
}

export interface ClipCompositionStyleOverrides {
  blur_intensity?: number;
  foreground_scale?: number;
  foreground_vertical_offset?: number;
}

export interface ClipStyleOverrides {
  style_preset?: ClipStylePresetId;
  hook?: ClipHookStyleOverrides;
  captions?: ClipCaptionStyleOverrides;
  composition?: ClipCompositionStyleOverrides;
}

export interface ProjectClipStyle {
  project_id: string;
  source_candidate_job_id: string;
  candidate_id: string;
  style_overrides: ClipStyleOverrides;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  files: FileItem[];
  jobs: JobSummary[];
  clip_style_defaults: ClipStyleOverrides | null;
  clip_styles: ProjectClipStyle[];
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
  enable_detailed_planner_logging: boolean;
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
  enable_detailed_planner_logging?: boolean;
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
  target_clip_min_sec: number;
  target_clip_max_sec: number;
  target_clip_ideal_sec: number;
  candidate_overlap_sec: number;
  max_candidates: number;
  scoring_weights: Record<string, number>;
  caption_behavior: string;
  export_mode: "center_blur_fill" | "vertical_9_16" | "source_aspect";
  caption_base_color: string;
  caption_active_word_color: string;
  caption_vertical_position: "lower" | "lower_middle";
  caption_max_lines: number;
  caption_max_words_per_line: number;
  blur_intensity: number;
}

export interface ClipStyleDraft {
  stylePreset: ClipStylePresetId;
  hook: {
    hookText: string;
    fontSize: number;
    topOffset: number;
    boxWidth: number;
    boxPadding: number;
    maxLines: number;
    textAlignment: ClipHookTextAlignment;
  };
  captions: {
    baseColor: string;
    activeWordColor: string;
    fontSize: number;
    verticalPosition: "lower" | "lower_middle";
    bottomOffset: number;
    maxLines: number;
    outlineStrength: number;
    shadowStrength: number;
  };
  composition: {
    blurIntensity: number;
    foregroundScale: number;
    foregroundVerticalOffset: number;
  };
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

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

export interface WordTimestamp {
  start: number;
  end: number;
  word: string;
}

export interface CandidateScoreBreakdown {
  hook_strength: number;
  self_containedness: number;
  conflict_tension: number;
  payoff_clarity: number;
  novelty_interestingness: number;
  niche_relevance: number;
  verbosity_penalty: number;
  overlap_duplication_penalty: number;
}

export interface CandidateClip {
  id: string;
  start_sec: number;
  end_sec: number;
  transcript_excerpt: string;
  title: string;
  hook_text: string;
  rationale: string;
  score_total: number;
  score_breakdown: CandidateScoreBreakdown | null;
  tags: string[];
  duplicate_group: string | null;
  subtitle_segments: SubtitleSegment[];
}

export interface TraceEvent {
  timestamp: string;
  stage: string;
  event: string;
  message: string;
  severity: "debug" | "info" | "warning" | "error";
  payload?: Record<string, unknown> | null;
}

export interface JobTraceResponse {
  job_id: string;
  events: TraceEvent[];
  artifacts: Record<string, string>;
}
