"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CloudUpload, Download, FolderOpen, History, PanelRightOpen, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { CandidateList } from "@/components/project/candidate-list";
import { ClipStyleEditor } from "@/components/project/clip-style-editor";
import { FileList } from "@/components/project/file-list";
import { GeneratePanel } from "@/components/project/generate-panel";
import { JobFeed } from "@/components/project/job-feed";
import { JobInspector } from "@/components/project/job-inspector";
import { MediaPreview } from "@/components/project/media-preview";
import { UploadDropzone } from "@/components/project/upload-dropzone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NameDialog } from "@/components/ui/name-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { hasClipStyleOverrides } from "@/lib/clip-style";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type {
  CandidateClip,
  ClipStyleOverrides,
  FileItem,
  JobCreateRequest,
  JobSummary,
  PresetConfig,
  ProjectClipStyle,
  ProjectDetail,
  SettingsResponse
} from "@/lib/types";

type LibraryTab = "uploads" | "outputs";

const FILE_FOCUS_SENTINEL = "__file_focus__";

function clipStyleKey(sourceCandidateJobId: string, candidateId: string) {
  return `${sourceCandidateJobId}:${candidateId}`;
}

function payloadString(job: JobSummary, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : null;
}

function candidateFromPayload(job: JobSummary) {
  const payloadCandidate = job.payload.candidate;
  if (!payloadCandidate || typeof payloadCandidate !== "object") {
    return null;
  }
  return payloadCandidate as CandidateClip;
}

function candidateReviewSourceJob(job: JobSummary | null, jobs: JobSummary[]) {
  if (!job) {
    return null;
  }

  if (job.kind === "shorts_candidate_generation" && job.status === "completed") {
    return job;
  }

  if (job.kind !== "short_export") {
    return null;
  }

  const sourceJobId = payloadString(job, "source_candidate_job_id");
  const sourceJob = sourceJobId ? jobs.find((item) => item.id === sourceJobId) : null;
  return sourceJob?.kind === "shorts_candidate_generation" && sourceJob.status === "completed" ? sourceJob : null;
}

function primaryFileForJob(job: JobSummary, files: FileItem[]) {
  const fileMap = new Map(files.map((file) => [file.id, file]));

  if (job.kind === "short_export" && job.result?.output_file_ids?.length) {
    const outputFiles = job.result.output_file_ids
      .map((fileId) => fileMap.get(fileId))
      .filter((file): file is FileItem => Boolean(file));
    return outputFiles.find((file) => file.role === "candidate_clip") || outputFiles[0] || fileMap.get(job.source_file_id) || null;
  }

  return fileMap.get(job.source_file_id) || null;
}

function outputFilesForJob(job: JobSummary | null, files: FileItem[]) {
  if (!job?.result?.output_file_ids?.length) {
    return [];
  }
  const fileMap = new Map(files.map((file) => [file.id, file]));
  return job.result.output_file_ids.map((fileId) => fileMap.get(fileId)).filter((file): file is FileItem => Boolean(file));
}

function candidateExportJobs(jobs: JobSummary[], sourceJobId: string, candidateId: string) {
  return jobs
    .filter(
      (job) =>
        job.kind === "short_export" &&
        payloadString(job, "source_candidate_job_id") === sourceJobId &&
        payloadString(job, "candidate_id") === candidateId
    )
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function candidateClipFile(sourceJob: JobSummary | null, candidate: CandidateClip | null, jobs: JobSummary[], files: FileItem[]) {
  if (!sourceJob || !candidate) {
    return null;
  }
  const completedExportJob = candidateExportJobs(jobs, sourceJob.id, candidate.id).find(
    (job) => job.status === "completed" && Boolean(job.result?.output_file_ids?.length)
  );
  return outputFilesForJob(completedExportJob || null, files).find((file) => file.role === "candidate_clip") || null;
}

function candidateTitle(candidate: CandidateClip) {
  return candidate.title.trim() || candidate.hook_text.trim() || "Untitled candidate";
}

function candidateSummary(candidate: CandidateClip) {
  return candidate.rationale.trim() || candidate.transcript_excerpt.trim() || candidate.hook_text.trim() || "Candidate summary unavailable.";
}

function selectedCandidateForJob(job: JobSummary | null, jobs: JobSummary[], selectedCandidateId?: string | null) {
  if (!job) {
    return null;
  }

  if (selectedCandidateId === FILE_FOCUS_SENTINEL) {
    return null;
  }

  const reviewJob = candidateReviewSourceJob(job, jobs);
  const candidates = reviewJob?.result?.candidates || [];
  const payloadCandidate = candidateFromPayload(job);

  if (selectedCandidateId) {
    const matchedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId);
    if (matchedCandidate) {
      return matchedCandidate;
    }
  }

  if (payloadCandidate) {
    return candidates.find((candidate) => candidate.id === payloadCandidate.id) || payloadCandidate;
  }

  return candidates[0] || null;
}

function mergeUploadedFiles(project: ProjectDetail, uploadedFiles: FileItem[]) {
  const uploadedIds = new Set(uploadedFiles.map((file) => file.id));
  const mergedFiles = [...uploadedFiles, ...project.files.filter((file) => !uploadedIds.has(file.id))];

  return {
    ...project,
    files: mergedFiles,
    updated_at: new Date().toISOString(),
    status_summary: {
      ...project.status_summary,
      upload_count: mergedFiles.filter((file) => file.kind === "upload").length
    }
  };
}

function upsertProjectClipStyle(
  project: ProjectDetail,
  sourceCandidateJobId: string,
  candidateId: string,
  record: ProjectClipStyle | null
) {
  const filtered = project.clip_styles.filter(
    (item) => !(item.source_candidate_job_id === sourceCandidateJobId && item.candidate_id === candidateId)
  );

  return {
    ...project,
    clip_styles: record ? [record, ...filtered] : filtered,
    updated_at: new Date().toISOString()
  };
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const projectRequestRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "processing" | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [previewStartSec, setPreviewStartSec] = useState<number | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("uploads");
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [clipEditorOpen, setClipEditorOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [runsDialogOpen, setRunsDialogOpen] = useState(false);

  async function loadProject() {
    const requestId = ++projectRequestRef.current;

    try {
      const nextProject = await api.getProject(projectId);
      if (requestId !== projectRequestRef.current) {
        return nextProject;
      }
      setProject(nextProject);
      return nextProject;
    } catch (error) {
      if (requestId === projectRequestRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not load project.");
      }
      return null;
    }
  }

  async function loadMeta() {
    try {
      const [presetResult, settingsResult] = await Promise.all([api.listPresets(), api.getSettings()]);
      setPresets(presetResult.items);
      setSettings(settingsResult);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settings.");
    }
  }

  useEffect(() => {
    let active = true;

    setLoading(true);
    setProject(null);

    async function bootstrap() {
      await Promise.all([loadProject(), loadMeta()]);
      if (active) {
        setLoading(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
      projectRequestRef.current += 1;
    };
  }, [projectId]);

  const sortedJobs = [...(project?.jobs || [])].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const activeJobs = sortedJobs.filter((job) => job.status === "queued" || job.status === "running");
  const uploads = project?.files.filter((file) => file.kind === "upload") || [];
  const outputs = project?.files.filter((file) => file.kind === "output") || [];
  const selectedFile = project?.files.find((file) => file.id === selectedFileId) || null;
  const firstJob = sortedJobs[0] ?? null;
  const defaultJob = sortedJobs.find((job) => candidateReviewSourceJob(job, sortedJobs)) ?? firstJob;
  const selectedJob = sortedJobs.find((job) => job.id === selectedJobId) || null;
  const candidateReviewJob = candidateReviewSourceJob(selectedJob, sortedJobs);
  const selectedCandidate = selectedCandidateForJob(selectedJob, sortedJobs, selectedCandidateId);

  useEffect(() => {
    if (!project) {
      return;
    }
    setSelectedFileId((current) =>
      current && project.files.some((file) => file.id === current)
        ? current
        : defaultJob
          ? primaryFileForJob(defaultJob, project.files)?.id ?? project.files[0]?.id ?? null
          : project.files[0]?.id ?? null
    );
  }, [defaultJob?.id, defaultJob?.updated_at, project?.id, project?.updated_at]);

  useEffect(() => {
    setSelectedJobId((current) => (current && sortedJobs.some((job) => job.id === current) ? current : defaultJob?.id ?? null));
  }, [defaultJob?.id, project?.id, project?.updated_at, sortedJobs.length]);

  useEffect(() => {
    const availableCandidates = candidateReviewJob?.result?.candidates || [];
    const fallbackCandidateId = selectedCandidateForJob(selectedJob, sortedJobs)?.id ?? null;
    setSelectedCandidateId((current) =>
      current === FILE_FOCUS_SENTINEL
        ? current
        : current && (availableCandidates.some((candidate) => candidate.id === current) || current === fallbackCandidateId)
        ? current
        : fallbackCandidateId
    );
  }, [
    candidateReviewJob?.id,
    candidateReviewJob?.updated_at,
    candidateReviewJob?.result?.candidate_count,
    firstJob?.id,
    project?.updated_at,
    selectedJob?.id,
    selectedJob?.updated_at
  ]);

  useEffect(() => {
    if (activeJobs.length === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadProject();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activeJobs.length, projectId]);

  const uploadBusy = uploadPhase !== null;

  async function handleUpload(files: File[]) {
    try {
      setUploadPhase("uploading");
      setUploadProgress(0);

      const response = await api.uploadFiles(projectId, files, ({ percent }) => {
        if (percent >= 100) {
          setUploadPhase("processing");
          setUploadProgress(null);
          return;
        }
        setUploadPhase("uploading");
        setUploadProgress(Math.max(0, Math.min(percent, 99)));
      });

      setUploadPhase("processing");
      setUploadProgress(null);
      setProject((current) => (current ? mergeUploadedFiles(current, response.files) : current));
      setSelectedFileId(response.files[0]?.id || null);
      setSelectedCandidateId(null);
      setPreviewStartSec(null);
      setLibraryTab("uploads");

      await loadProject();

      if (response.errors.length > 0) {
        toast.warning(response.errors.join(" "));
      } else {
        toast.success("Upload complete.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploadProgress(null);
      setUploadPhase(null);
    }
  }

  async function handleRenameFile(name: string) {
    if (!renameTarget) {
      return;
    }
    try {
      await api.renameFile(projectId, renameTarget.id, name);
      await loadProject();
      toast.success("File renamed.");
      setRenameTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename file.");
    }
  }

  async function handleDeleteFile() {
    if (!deleteTarget) {
      return;
    }
    try {
      await api.deleteFile(projectId, deleteTarget.id);
      if (selectedFileId === deleteTarget.id) {
        setSelectedFileId(null);
        setPreviewStartSec(null);
      }
      await loadProject();
      toast.success("File deleted.");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete file.");
    }
  }

  async function handleCreateJob(payload: JobCreateRequest) {
    try {
      setJobBusy(true);
      const createdJob = await api.createJob(projectId, payload);
      setSelectedJobId(createdJob.id);
      setSelectedCandidateId(null);
      setSelectedFileId(payload.source_file_id);
      setPreviewStartSec(null);
      setInspectorOpen(false);
      await loadProject();
      toast.success("Shorts candidate job queued.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create job.");
      return false;
    } finally {
      setJobBusy(false);
    }
  }

  async function handleQuickGenerate(sourceFile: FileItem | null, quickPreset: PresetConfig | null) {
    if (!sourceFile) {
      setLibraryDialogOpen(true);
      toast.warning("Upload a source file before generating candidates.");
      return;
    }

    if (!quickPreset || !settings) {
      toast.error("Generator defaults are not available yet.");
      return;
    }

    await handleCreateJob({
      source_file_id: sourceFile.id,
      preset_id: quickPreset.id,
      aggressiveness: settings.cut_aggressiveness,
      captions_enabled: settings.captions_enabled,
      generate_shorts: true
    });
  }

  async function handleCancelJob(jobId: string) {
    try {
      await api.cancelJob(jobId);
      await loadProject();
      toast.success("Job canceled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel job.");
    }
  }

  async function persistClipStyle(
    sourceCandidateJobId: string,
    candidateId: string,
    overrides: ClipStyleOverrides | undefined,
    options?: { notify?: boolean }
  ) {
    const nextOverrides = overrides && hasClipStyleOverrides(overrides) ? overrides : undefined;

    try {
      const record = await api.saveClipStyle(projectId, sourceCandidateJobId, candidateId, nextOverrides);
      setProject((current) =>
        current ? upsertProjectClipStyle(current, sourceCandidateJobId, candidateId, record) : current
      );
      if (options?.notify !== false) {
        toast.success(nextOverrides ? "Clip style saved." : "Clip style reset.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save clip style.");
      throw error;
    }
  }

  async function persistProjectDefaultClipStyle(overrides: ClipStyleOverrides | undefined, options?: { notify?: boolean }) {
    const nextOverrides = overrides && hasClipStyleOverrides(overrides) ? overrides : undefined;

    try {
      const response = await api.saveProjectClipStyleDefaults(projectId, nextOverrides);
      setProject((current) =>
        current
          ? {
              ...current,
              clip_style_defaults: response?.style_overrides ?? null,
              updated_at: new Date().toISOString()
            }
          : current
      );
      if (options?.notify !== false) {
        toast.success(nextOverrides ? "Project default clip style saved." : "Project default clip style cleared.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the project default style.");
      throw error;
    }
  }

  async function handleExportCandidate(job: JobSummary, candidate: CandidateClip, styleOverrides?: ClipStyleOverrides) {
    const savedClipStyle = project?.clip_styles.find(
      (item) => item.source_candidate_job_id === job.id && item.candidate_id === candidate.id
    )?.style_overrides;
    const candidateStyleOverrides =
      styleOverrides === undefined
        ? savedClipStyle || project?.clip_style_defaults || undefined
        : styleOverrides && hasClipStyleOverrides(styleOverrides)
        ? styleOverrides
        : undefined;
    try {
      const exportJob = await api.exportCandidate(
        projectId,
        job.id,
        candidate.id,
        job.captions_enabled,
        candidateStyleOverrides
      );
      setSelectedJobId(exportJob.id);
      setSelectedCandidateId(candidate.id);
      setSelectedFileId(job.source_file_id);
      setPreviewStartSec(candidate.start_sec);
      await loadProject();
      toast.success(candidateStyleOverrides ? "Styled short export queued." : "Short export queued.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export candidate.");
    }
  }

  function handlePreviewCandidate(job: JobSummary, candidate: CandidateClip) {
    setLibraryTab("uploads");
    setSelectedJobId(job.id);
    setSelectedCandidateId(candidate.id);
    setSelectedFileId(job.source_file_id);
    setPreviewStartSec(candidate.start_sec);
  }

  function handleSelectFile(file: FileItem) {
    setLibraryTab(file.kind === "output" ? "outputs" : "uploads");
    setSelectedCandidateId(FILE_FOCUS_SENTINEL);
    setSelectedFileId(file.id);
    setPreviewStartSec(null);
    setInspectorOpen(false);
    setClipEditorOpen(false);
  }

  function handleSelectFileFromLibrary(file: FileItem) {
    handleSelectFile(file);
    setLibraryDialogOpen(false);
  }

  function handleSelectRun(job: JobSummary) {
    const nextCandidate = selectedCandidateForJob(job, sortedJobs, selectedCandidateId);
    const nextFile = project ? primaryFileForJob(job, project.files) : null;
    setLibraryTab(nextFile?.kind === "output" ? "outputs" : "uploads");
    setSelectedJobId(job.id);
    setSelectedCandidateId(nextCandidate?.id ?? null);
    setSelectedFileId(nextFile?.id ?? job.source_file_id);
    setPreviewStartSec(nextFile && nextFile.id !== job.source_file_id ? null : nextCandidate?.start_sec ?? null);
    setInspectorOpen(false);
  }

  function handleSelectRunFromDialog(job: JobSummary) {
    handleSelectRun(job);
    setRunsDialogOpen(false);
  }

  function handleSelectCandidate(job: JobSummary, candidate: CandidateClip) {
    setLibraryTab("uploads");
    setSelectedJobId(job.id);
    setSelectedCandidateId(candidate.id);
    setSelectedFileId(job.source_file_id);
    setPreviewStartSec(candidate.start_sec);
  }

  function handleOpenCandidateDetails(job: JobSummary, candidate: CandidateClip) {
    handleSelectCandidate(job, candidate);
    setInspectorOpen(true);
  }

  function handleOpenCandidateEditor(job: JobSummary, candidate: CandidateClip) {
    handleSelectCandidate(job, candidate);
    setClipEditorOpen(true);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-y-auto lg:pr-1">
        <Skeleton className="h-[148px] w-full rounded-[32px]" />
        <Skeleton className="h-[560px] w-full rounded-[36px]" />
        <Skeleton className="h-[720px] w-full rounded-[36px]" />
      </div>
    );
  }

  if (!project || !settings) {
    return (
      <Card>
        <CardContent className="px-6 py-10 text-sm leading-6 text-muted-foreground">
          This project could not be loaded.
        </CardContent>
      </Card>
    );
  }

  const libraryFiles = libraryTab === "uploads" ? uploads : outputs;
  const candidateSourceFile = candidateReviewJob ? project.files.find((file) => file.id === candidateReviewJob.source_file_id) || null : null;
  const selectedCandidateExportRuns =
    candidateReviewJob && selectedCandidate ? candidateExportJobs(sortedJobs, candidateReviewJob.id, selectedCandidate.id) : [];
  const selectedCandidateActiveExport = selectedCandidateExportRuns.find((job) => job.status === "queued" || job.status === "running");
  const selectedCandidateClip = candidateClipFile(candidateReviewJob, selectedCandidate, sortedJobs, project.files);
  const clipStyleMap = new Map(project.clip_styles.map((item) => [clipStyleKey(item.source_candidate_job_id, item.candidate_id), item.style_overrides]));
  const editedCandidateIds = new Set(
    candidateReviewJob
      ? (candidateReviewJob.result?.candidates || [])
          .filter((candidate) => clipStyleMap.has(clipStyleKey(candidateReviewJob.id, candidate.id)))
          .map((candidate) => candidate.id)
      : []
  );
  const selectedCandidateStyle =
    candidateReviewJob && selectedCandidate ? clipStyleMap.get(clipStyleKey(candidateReviewJob.id, selectedCandidate.id)) : undefined;
  const selectedEffectiveStyle = selectedCandidateStyle || project.clip_style_defaults || undefined;
  const selectedCandidateEdited = selectedCandidate ? editedCandidateIds.has(selectedCandidate.id) : false;
  const selectedUsingProjectDefault = Boolean(selectedCandidate && !selectedCandidateStyle && project.clip_style_defaults);
  const clipStyleCopySources =
    candidateReviewJob
      ? [
          ...(project.clip_style_defaults
            ? [
                {
                  id: "__project_default__",
                  label: "Project default",
                  styleOverrides: project.clip_style_defaults
                }
              ]
            : []),
          ...(candidateReviewJob.result?.candidates || [])
            .filter((candidate) => !selectedCandidate || candidate.id !== selectedCandidate.id)
            .map((candidate) => {
              const styleOverrides = clipStyleMap.get(clipStyleKey(candidateReviewJob.id, candidate.id));
              return styleOverrides
                ? {
                    id: clipStyleKey(candidateReviewJob.id, candidate.id),
                    label: candidateTitle(candidate),
                    styleOverrides
                  }
                : null;
            })
            .filter((item): item is { id: string; label: string; styleOverrides: ClipStyleOverrides } => Boolean(item))
        ]
      : [];
  const currentSourceFile = (selectedFile?.kind === "upload" ? selectedFile : null) || candidateSourceFile || uploads[0] || null;
  const currentPresetId = candidateReviewJob?.preset_id ?? selectedJob?.preset_id ?? settings.default_preset;
  const currentPreset =
    presets.find((preset) => preset.id === currentPresetId) ||
    presets.find((preset) => preset.id === settings.default_preset) ||
    presets[0] ||
    null;
  const focusedPreviewFile = selectedCandidate ? selectedCandidateClip || candidateSourceFile || selectedFile || currentSourceFile : selectedFile || currentSourceFile;
  const focusedPreviewStartSec = selectedCandidate && !selectedCandidateClip ? selectedCandidate.start_sec : previewStartSec;
  const downloadTarget = selectedCandidateClip || focusedPreviewFile;
  const uploadLabel =
    uploadPhase === "processing"
      ? "Finalizing upload"
      : uploadPhase === "uploading" && uploadProgress !== null
      ? `Uploading ${uploadProgress}%`
      : "Upload";
  const previewTitle = selectedCandidate
    ? candidateTitle(selectedCandidate)
    : focusedPreviewFile
      ? focusedPreviewFile.name
      : "Preview stage";
  const previewDescription = selectedCandidate
    ? candidateSummary(selectedCandidate)
    : focusedPreviewFile
      ? "Select a ranked clip below to retime this preview or export the result."
      : "Upload one source, generate ranked clips, and use the gallery below as the main scan surface.";
  const exportLabel = selectedCandidateActiveExport
    ? "Exporting"
    : selectedCandidateClip
      ? "Re-export Selected"
      : "Export Selected";

  return (
    <div className="flex flex-col gap-5 lg:h-full lg:overflow-y-auto lg:pr-1">
      <div className="sticky top-0 z-20 pb-1">
        <div className="app-frame rounded-[32px] border border-border/70 px-5 py-4 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="panel-label">Project Workspace</p>
                <Badge variant={activeJobs.length ? "warning" : "muted"}>{activeJobs.length ? `${activeJobs.length} active` : "idle"}</Badge>
              </div>
              <h1 className="mt-2 text-[1.8rem] font-semibold tracking-tight text-foreground">{project.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-muted-foreground">
                  Source: <span className="font-medium text-foreground">{currentSourceFile?.name || "Upload a source"}</span>
                </span>
                <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-muted-foreground">
                  Preset: <span className="font-medium text-foreground">{currentPreset?.name || "Unavailable"}</span>
                </span>
                <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selectedCandidate ? candidateTitle(selectedCandidate) : "Scan the gallery"}</span>
                </span>
                {selectedCandidateEdited ? (
                  <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-muted-foreground">
                    Style: <span className="font-medium text-foreground">Edited</span>
                  </span>
                ) : selectedUsingProjectDefault ? (
                  <span className="rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-muted-foreground">
                    Style: <span className="font-medium text-foreground">Project default</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {uploadPhase === "processing"
                  ? "Saving the upload and refreshing the project library."
                  : uploadPhase === "uploading" && uploadProgress !== null
                  ? `Upload is in progress at ${uploadProgress}%.`
                  : "One obvious path: upload, generate, scan ranked clips, and export the winner."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:max-w-[700px] xl:justify-end">
              <Button disabled={uploadBusy || jobBusy} onClick={() => uploadInputRef.current?.click()}>
                <CloudUpload className="mr-2 size-4" />
                {uploadLabel}
              </Button>
              <Button
                disabled={!currentSourceFile || !currentPreset || jobBusy || uploadBusy}
                onClick={() => void handleQuickGenerate(currentSourceFile, currentPreset)}
              >
                <Sparkles className="mr-2 size-4" />
                {jobBusy ? "Generating..." : "Generate Shorts Candidates"}
              </Button>
              <Button
                variant="secondary"
                disabled={!selectedCandidate || !candidateReviewJob}
                onClick={() => {
                  if (selectedCandidate && candidateReviewJob) {
                    handleOpenCandidateEditor(candidateReviewJob, selectedCandidate);
                  }
                }}
              >
                <SlidersHorizontal className="mr-2 size-4" />
                Edit Clip
              </Button>
              <Button
                disabled={!selectedCandidate || !candidateReviewJob || Boolean(selectedCandidateActiveExport) || uploadBusy}
                onClick={() => {
                  if (selectedCandidate && candidateReviewJob) {
                    void handleExportCandidate(candidateReviewJob, selectedCandidate);
                  }
                }}
              >
                <Download className="mr-2 size-4" />
                {exportLabel}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setGenerateDialogOpen(true)}>
                Options
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setLibraryDialogOpen(true)}>
                <FolderOpen className="mr-2 size-4" />
                Library
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setRunsDialogOpen(true)}>
                <History className="mr-2 size-4" />
                Runs
              </Button>
              {selectedCandidate && candidateReviewJob ? (
                <Button variant="secondary" size="sm" onClick={() => handleOpenCandidateDetails(candidateReviewJob, selectedCandidate)}>
                  <PanelRightOpen className="mr-2 size-4" />
                  Details
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <input
          ref={uploadInputRef}
          hidden
          multiple
          accept="video/*,audio/*"
          type="file"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files && files.length > 0) {
              void handleUpload(Array.from(files));
            }
            event.currentTarget.value = "";
          }}
        />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="panel-label">Preview Stage</p>
              {selectedCandidate ? <Badge>{Math.round(selectedCandidate.score_total)} score</Badge> : null}
              {selectedCandidateClip ? <Badge variant="success">Rendered</Badge> : null}
              {selectedCandidateEdited ? <Badge variant="muted">Edited</Badge> : null}
              {!selectedCandidateEdited && selectedUsingProjectDefault ? <Badge variant="muted">Project default</Badge> : null}
              {selectedCandidateActiveExport ? <Badge variant="warning">Exporting</Badge> : null}
              {selectedCandidate ? (
                <Badge variant="muted">
                  {formatDuration(selectedCandidate.end_sec - selectedCandidate.start_sec)} at{" "}
                  {formatTimestamp(selectedCandidate.start_sec, 1)}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{previewTitle}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{previewDescription}</p>
          </div>

            <div className="flex flex-wrap gap-2">
            {selectedCandidate && candidateReviewJob ? (
              <Button variant="secondary" onClick={() => handleOpenCandidateEditor(candidateReviewJob, selectedCandidate)}>
                <SlidersHorizontal className="mr-2 size-4" />
                Edit clip
              </Button>
            ) : null}
            {selectedCandidate && candidateReviewJob ? (
              <Button variant="secondary" onClick={() => handleOpenCandidateDetails(candidateReviewJob, selectedCandidate)}>
                <PanelRightOpen className="mr-2 size-4" />
                Open details
              </Button>
            ) : null}
            {downloadTarget ? (
              <Button variant="secondary" asChild>
                <a href={downloadTarget.download_url} download>
                  <Download className="mr-2 size-4" />
                  {selectedCandidateClip ? "Download clip" : "Download focus"}
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        <MediaPreview file={focusedPreviewFile} previewStartSec={focusedPreviewStartSec} showHeader={false} showMetadata={false} />
      </section>

      <CandidateList
        sourceJob={candidateReviewJob}
        jobs={sortedJobs}
        sourceFile={candidateSourceFile}
        selectedCandidate={selectedCandidate}
        selectedCandidateId={selectedCandidateId === FILE_FOCUS_SENTINEL ? null : selectedCandidateId}
        onSelectCandidate={handleSelectCandidate}
        onPreviewCandidate={handlePreviewCandidate}
        onExportCandidate={handleExportCandidate}
        onOpenDetails={handleOpenCandidateDetails}
        onEditCandidate={handleOpenCandidateEditor}
        editedCandidateIds={editedCandidateIds}
      />

      <ClipStyleEditor
        open={clipEditorOpen}
        onOpenChange={setClipEditorOpen}
        sourceJobId={candidateReviewJob?.id || null}
        candidate={selectedCandidate}
        sourceFile={candidateSourceFile || currentSourceFile}
        preset={currentPreset}
        activeOverrides={selectedEffectiveStyle}
        hasClipSpecificStyle={selectedCandidateEdited}
        copySources={clipStyleCopySources}
        busy={Boolean(selectedCandidateActiveExport) || uploadBusy}
        onSaveClipStyle={async (overrides, options) => {
          if (selectedCandidate && candidateReviewJob) {
            await persistClipStyle(candidateReviewJob.id, selectedCandidate.id, overrides, options);
          }
        }}
        onSaveProjectDefault={async (overrides, options) => {
          await persistProjectDefaultClipStyle(overrides, options);
        }}
        onRender={async (overrides) => {
          if (selectedCandidate && candidateReviewJob) {
            await handleExportCandidate(candidateReviewJob, selectedCandidate, overrides);
          }
        }}
      />

      <Dialog open={libraryDialogOpen} onOpenChange={setLibraryDialogOpen}>
        <DialogContent className="left-auto right-5 top-5 h-[calc(100vh-2.5rem)] w-[min(94vw,820px)] max-w-none -translate-x-0 -translate-y-0 overflow-hidden p-0">
          <div className="flex h-full flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <DialogTitle>Project library</DialogTitle>
              <DialogDescription>Manage source uploads and exported artifacts without crowding the main review flow.</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <UploadDropzone
                    compact
                    uploadPhase={uploadPhase}
                    uploadProgress={uploadProgress}
                    onFilesSelected={handleUpload}
                    disabled={uploadBusy || jobBusy}
                  />

                  <div className="panel-gradient rounded-[28px] border border-border/70 p-4 shadow-soft">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="panel-inset rounded-[18px] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Uploads</p>
                        <p className="mt-2 text-base font-semibold text-foreground">{uploads.length}</p>
                      </div>
                      <div className="panel-inset rounded-[18px] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Outputs</p>
                        <p className="mt-2 text-base font-semibold text-foreground">{outputs.length}</p>
                      </div>
                      <div className="panel-inset rounded-[18px] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Runs</p>
                        <p className="mt-2 text-base font-semibold text-foreground">{sortedJobs.length}</p>
                      </div>
                    </div>

                    <div className="panel-inset mt-3 rounded-[20px] px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Current source</p>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">{currentSourceFile?.name || "No source selected"}</p>
                    </div>
                  </div>
                </div>

                <FileList
                  title="Project library"
                  description={
                    libraryTab === "uploads"
                      ? `${uploads.length} source file${uploads.length === 1 ? "" : "s"} ready for review.`
                      : `${outputs.length} generated artifact${outputs.length === 1 ? "" : "s"} in this project.`
                  }
                  actions={
                    <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 p-1">
                      <Button type="button" size="sm" variant={libraryTab === "uploads" ? "default" : "ghost"} onClick={() => setLibraryTab("uploads")}>
                        Uploads
                      </Button>
                      <Button type="button" size="sm" variant={libraryTab === "outputs" ? "default" : "ghost"} onClick={() => setLibraryTab("outputs")}>
                        Outputs
                      </Button>
                    </div>
                  }
                  files={libraryFiles}
                  selectedFileId={selectedFileId}
                  emptyMessage={
                    libraryTab === "uploads"
                      ? "Use the sticky upload action or the dropzone above to add source media."
                      : "Generated artifacts will appear here after exports finish."
                  }
                  onSelect={handleSelectFileFromLibrary}
                  onRename={setRenameTarget}
                  onDelete={setDeleteTarget}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={runsDialogOpen} onOpenChange={setRunsDialogOpen}>
        <DialogContent className="left-auto right-5 top-5 h-[calc(100vh-2.5rem)] w-[min(92vw,720px)] max-w-none -translate-x-0 -translate-y-0 overflow-hidden p-0">
          <div className="flex h-full flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <DialogTitle>Recent runs</DialogTitle>
              <DialogDescription>Inspect candidate generation and export activity without leaving the gallery workflow.</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <JobFeed jobs={sortedJobs} selectedJobId={selectedJobId} onSelectJob={handleSelectRunFromDialog} onCancel={(job) => handleCancelJob(job.id)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent className="max-w-[780px] overflow-hidden p-0">
          <GeneratePanel
            className="rounded-none border-0 shadow-none"
            uploads={uploads}
            presets={presets}
            defaultPreset={currentPreset?.id || settings.default_preset}
            defaultAggressiveness={settings.cut_aggressiveness}
            defaultCaptions={settings.captions_enabled}
            busy={jobBusy || uploadBusy}
            onSubmit={async (payload) => {
              const created = await handleCreateJob(payload);
              if (created) {
                setGenerateDialogOpen(false);
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="left-auto right-5 top-5 h-[calc(100vh-2.5rem)] w-[min(92vw,620px)] max-w-none -translate-x-0 -translate-y-0 overflow-hidden p-0">
          <JobInspector
            className="h-full rounded-none border-0 bg-transparent shadow-none"
            job={selectedJob}
            candidate={selectedCandidate}
            jobs={sortedJobs}
            files={project.files}
            onExportCandidate={handleExportCandidate}
            onPreviewCandidate={handlePreviewCandidate}
            onSelectFile={handleSelectFile}
          />
        </DialogContent>
      </Dialog>

      <NameDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
        title="Rename file"
        description="Keep the original extension. The app will preserve storage safety and avoid name collisions."
        label="File name"
        initialValue={renameTarget?.name}
        submitLabel="Save name"
        onSubmit={handleRenameFile}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the file from the project storage on the DGX Spark. Generated jobs that depend on active source files cannot continue if those files are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFile}>Delete file</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
