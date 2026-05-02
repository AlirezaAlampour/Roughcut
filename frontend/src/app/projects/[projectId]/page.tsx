"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronDown, Download, PanelRightOpen, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { CandidateList } from "@/components/project/candidate-list";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NameDialog } from "@/components/ui/name-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime, formatDuration, formatTimestamp } from "@/lib/format";
import type {
  CandidateClip,
  FileItem,
  JobCreateRequest,
  JobSummary,
  PresetConfig,
  ProjectDetail,
  SettingsResponse
} from "@/lib/types";

type LibraryTab = "uploads" | "outputs";

const FILE_FOCUS_SENTINEL = "__file_focus__";

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

function candidateHook(candidate: CandidateClip) {
  return candidate.hook_text.trim() || candidate.title.trim() || "";
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

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const projectRequestRef = useRef(0);

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
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [runsOpen, setRunsOpen] = useState(false);

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

  useEffect(() => {
    if (uploads.length === 0) {
      setLibraryOpen(true);
    }
  }, [uploads.length]);

  useEffect(() => {
    if (activeJobs.length > 0) {
      setRunsOpen(true);
    }
  }, [activeJobs.length]);

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
      setLibraryOpen(true);

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
      setRunsOpen(true);
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
      setLibraryOpen(true);
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

  async function handleExportCandidate(job: JobSummary, candidate: CandidateClip) {
    try {
      const exportJob = await api.exportCandidate(projectId, job.id, candidate.id, job.captions_enabled);
      setSelectedJobId(exportJob.id);
      setSelectedCandidateId(candidate.id);
      setSelectedFileId(job.source_file_id);
      setPreviewStartSec(candidate.start_sec);
      setRunsOpen(true);
      await loadProject();
      toast.success("Short export queued.");
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

  if (loading) {
    return (
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-y-auto lg:pr-1">
        <Skeleton className="h-[170px] w-full rounded-[34px]" />
        <Skeleton className="h-[210px] w-full rounded-[32px]" />
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
  const focusedPreviewFile = selectedCandidate ? selectedCandidateClip || candidateSourceFile || selectedFile : selectedFile;
  const focusedPreviewStartSec = selectedCandidate && !selectedCandidateClip ? selectedCandidate.start_sec : previewStartSec;
  const downloadTarget = focusedPreviewFile || selectedFile;
  const focusLabel = selectedCandidate ? candidateTitle(selectedCandidate) : selectedFile?.name || "Nothing selected";
  const quickPreset = presets.find((preset) => preset.id === settings.default_preset) || presets[0] || null;
  const quickSourceFile =
    (selectedFile?.kind === "upload" ? selectedFile : null) || candidateSourceFile || uploads[0] || null;

  return (
    <div className="flex flex-col gap-5 lg:h-full lg:overflow-y-auto lg:pr-1">
      <div className="app-frame rounded-[32px] border border-border/70 px-5 py-5 shadow-soft">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="panel-label">Project Workspace</p>
              <Badge variant="muted">{project.status_summary.upload_count} uploads</Badge>
              <Badge variant="muted">{project.status_summary.output_count} outputs</Badge>
              <Badge variant={activeJobs.length ? "warning" : "muted"}>{activeJobs.length ? `${activeJobs.length} active` : "idle"}</Badge>
            </div>
            <h1 className="mt-2 text-[1.9rem] font-semibold tracking-tight text-foreground lg:text-[2.4rem]">{project.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Created {formatDateTime(project.created_at)}. Upload once, generate ranked candidates, review clips, and export only the winners.
            </p>
          </div>

          <div className="panel-inset rounded-[22px] px-4 py-3 xl:max-w-[320px]">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Current focus</p>
            <p className="mt-2 truncate text-sm font-medium text-foreground">{focusLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">Updated {formatDateTime(project.updated_at)}</p>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 pb-1">
        <div className="rounded-[30px] border border-border/70 bg-background/94 p-3 shadow-soft backdrop-blur">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)]">
            <UploadDropzone
              compact
              uploadPhase={uploadPhase}
              uploadProgress={uploadProgress}
              onFilesSelected={handleUpload}
              disabled={uploadBusy || jobBusy}
            />

            <Card className="overflow-hidden">
              <CardContent className="flex h-full flex-col gap-4 px-5 pb-5 pt-5">
                <div>
                  <p className="panel-label">Generate</p>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">Generate shorts candidates</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {quickSourceFile
                      ? `Uses ${quickSourceFile.name} with ${quickPreset?.name || "your default preset"}.`
                      : "Choose or upload a source file to start a new ranked candidate run."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="panel-inset rounded-[20px] px-3.5 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Source</p>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">{quickSourceFile?.name || "No source selected"}</p>
                  </div>
                  <div className="panel-inset rounded-[20px] px-3.5 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Default preset</p>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">{quickPreset?.name || "Unavailable"}</p>
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    disabled={!quickSourceFile || !quickPreset || jobBusy || uploadBusy}
                    onClick={() => void handleQuickGenerate(quickSourceFile, quickPreset)}
                  >
                    <Sparkles className="mr-2 size-4" />
                    {jobBusy ? "Generating..." : "Generate Shorts Candidates"}
                  </Button>
                  <Button variant="secondary" onClick={() => setGenerateDialogOpen(true)}>
                    More options
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="flex h-full flex-col gap-4 px-5 pb-5 pt-5">
                <div>
                  <p className="panel-label">Export</p>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">Export selected clip</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {selectedCandidate
                      ? candidateTitle(selectedCandidate)
                      : "Pick a ranked candidate below and its export action stays parked here."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="panel-inset rounded-[20px] px-3.5 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Status</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {selectedCandidateActiveExport ? "Exporting now" : selectedCandidateClip ? "Clip ready" : "Not exported"}
                    </p>
                  </div>
                  <div className="panel-inset rounded-[20px] px-3.5 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Range</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {selectedCandidate
                        ? `${formatTimestamp(selectedCandidate.start_sec, 1)} - ${formatTimestamp(selectedCandidate.end_sec, 1)}`
                        : "Select a candidate"}
                    </p>
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    disabled={!selectedCandidate || !candidateReviewJob || Boolean(selectedCandidateActiveExport) || uploadBusy}
                    onClick={() => {
                      if (selectedCandidate && candidateReviewJob) {
                        void handleExportCandidate(candidateReviewJob, selectedCandidate);
                      }
                    }}
                  >
                    <Sparkles className="mr-2 size-4" />
                    {selectedCandidateActiveExport ? "Exporting" : selectedCandidateClip ? "Re-export Selected" : "Export Selected"}
                  </Button>
                  {selectedCandidate && candidateReviewJob ? (
                    <Button variant="secondary" onClick={() => handleOpenCandidateDetails(candidateReviewJob, selectedCandidate)}>
                      <PanelRightOpen className="mr-2 size-4" />
                      Details
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <MediaPreview file={focusedPreviewFile} previewStartSec={focusedPreviewStartSec} />

      <Card className="overflow-hidden">
        <CardContent className="px-5 pb-5 pt-5">
          {selectedCandidate && candidateReviewJob ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{Math.round(selectedCandidate.score_total)} score</Badge>
                {selectedCandidateClip ? <Badge variant="success">Rendered</Badge> : null}
                {selectedCandidateActiveExport ? <Badge variant="warning">Exporting</Badge> : null}
                {selectedCandidate.duplicate_group ? <Badge variant="muted">duplicate {selectedCandidate.duplicate_group}</Badge> : null}
              </div>

              <div>
                <p className="panel-label">Focused clip</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{candidateTitle(selectedCandidate)}</h2>
                {candidateHook(selectedCandidate) ? (
                  <p className="mt-2 text-sm font-medium leading-6 text-foreground">{candidateHook(selectedCandidate)}</p>
                ) : null}
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{candidateSummary(selectedCandidate)}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Duration</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {formatDuration(selectedCandidate.end_sec - selectedCandidate.start_sec)}
                  </p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Clip range</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {formatTimestamp(selectedCandidate.start_sec, 1)} - {formatTimestamp(selectedCandidate.end_sec, 1)}
                  </p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Source file</p>
                  <p className="mt-1 truncate text-sm font-medium text-foreground">{candidateSourceFile?.name || "Unavailable"}</p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Output</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {selectedCandidateClip ? "Rendered clip ready" : selectedCandidateActiveExport ? "Rendering" : "Export not started"}
                  </p>
                </div>
              </div>

              {selectedCandidate.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedCandidate.tags.map((tag) => (
                    <Badge key={tag} variant="muted">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => handlePreviewCandidate(candidateReviewJob, selectedCandidate)}>
                  <Play className="mr-2 size-4" />
                  Source preview
                </Button>
                <Button variant="secondary" onClick={() => handleOpenCandidateDetails(candidateReviewJob, selectedCandidate)}>
                  <PanelRightOpen className="mr-2 size-4" />
                  Open details
                </Button>
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
          ) : selectedFile ? (
            <div className="space-y-4">
              <div>
                <p className="panel-label">Focused media</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{selectedFile.name}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Review the source or output here, then drop into the ranked gallery when you want to pick a clip.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Kind</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{selectedFile.kind === "upload" ? "Source upload" : "Generated output"}</p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Type</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{selectedFile.media_type}</p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Size</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{formatBytes(selectedFile.size_bytes)}</p>
                </div>
                <div className="panel-inset rounded-[20px] px-3.5 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Duration</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{formatDuration(selectedFile.duration_seconds)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <a href={selectedFile.download_url} download>
                    <Download className="mr-2 size-4" />
                    Download file
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/60 px-5 py-6 text-center">
              <p className="panel-label">Focused review</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">Upload a source or select a candidate</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The preview stays first, the ranked gallery stays second, and deeper transcript or trace details stay tucked behind the detail drawer.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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
      />

      <details
        open={libraryOpen}
        onToggle={(event) => setLibraryOpen(event.currentTarget.open)}
        className="group rounded-[30px] border border-border/70 bg-card/76 p-3 shadow-soft [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-2 py-1.5">
          <div>
            <p className="panel-label">Library</p>
            <p className="mt-1 text-sm font-medium text-foreground">Uploads and generated outputs</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="muted">{libraryFiles.length}</Badge>
            <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
          </div>
        </summary>

        <div className="mt-3">
          <FileList
            className="rounded-none border-0 bg-transparent shadow-none"
            contentClassName="px-1 pb-1 pt-0"
            listClassName="pb-1"
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
                ? "Use the sticky upload action above to bring in source media."
                : "Generated artifacts will appear here after a run finishes."
            }
            onSelect={handleSelectFile}
            onRename={setRenameTarget}
            onDelete={setDeleteTarget}
          />
        </div>
      </details>

      <details
        open={runsOpen}
        onToggle={(event) => setRunsOpen(event.currentTarget.open)}
        className="group rounded-[30px] border border-border/70 bg-card/76 p-3 shadow-soft [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-2 py-1.5">
          <div>
            <p className="panel-label">Runs</p>
            <p className="mt-1 text-sm font-medium text-foreground">Recent candidate and export activity</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={activeJobs.length ? "warning" : "muted"}>{activeJobs.length ? `${activeJobs.length} active` : sortedJobs.length}</Badge>
            <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
          </div>
        </summary>

        <div className="mt-3">
          <JobFeed jobs={sortedJobs} selectedJobId={selectedJobId} onSelectJob={handleSelectRun} onCancel={(job) => handleCancelJob(job.id)} />
        </div>
      </details>

      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent className="max-w-[780px] overflow-hidden p-0">
          <GeneratePanel
            className="rounded-none border-0 shadow-none"
            uploads={uploads}
            presets={presets}
            defaultPreset={settings.default_preset}
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
