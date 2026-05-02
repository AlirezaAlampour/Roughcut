"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NameDialog } from "@/components/ui/name-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
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

function selectedCandidateForJob(job: JobSummary | null, jobs: JobSummary[], selectedCandidateId?: string | null) {
  if (!job) {
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

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [previewStartSec, setPreviewStartSec] = useState<number | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("uploads");
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);

  async function loadProject() {
    try {
      setProject(await api.getProject(projectId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load project.");
    } finally {
      setLoading(false);
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
    void Promise.all([loadProject(), loadMeta()]);
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
      current && (availableCandidates.some((candidate) => candidate.id === current) || current === fallbackCandidateId)
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

  async function handleUpload(files: File[]) {
    try {
      setUploadProgress(0);
      const response = await api.uploadFiles(projectId, files, ({ percent }) => setUploadProgress(percent));
      await loadProject();
      setSelectedFileId(response.files[0]?.id || null);
      setPreviewStartSec(null);
      setLibraryTab("uploads");
      if (response.errors.length > 0) {
        toast.warning(response.errors.join(" "));
      } else {
        toast.success("Upload complete.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploadProgress(null);
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
      await loadProject();
      toast.success("Shorts candidate job queued.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create job.");
    } finally {
      setJobBusy(false);
    }
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
      await loadProject();
      toast.success("Short export queued.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export candidate.");
    }
  }

  function handlePreviewCandidate(job: JobSummary, candidate: CandidateClip) {
    setLibraryTab("uploads");
    setSelectedFileId(job.source_file_id);
    setPreviewStartSec(candidate.start_sec);
  }

  function handleSelectFile(file: FileItem) {
    setLibraryTab(file.kind === "output" ? "outputs" : "uploads");
    setSelectedFileId(file.id);
    setPreviewStartSec(null);
  }

  function handleSelectRun(job: JobSummary) {
    const nextCandidate = selectedCandidateForJob(job, sortedJobs, selectedCandidateId);
    const nextFile = project ? primaryFileForJob(job, project.files) : null;
    setLibraryTab(nextFile?.kind === "output" ? "outputs" : "uploads");
    setSelectedJobId(job.id);
    setSelectedCandidateId(nextCandidate?.id ?? null);
    setSelectedFileId(nextFile?.id ?? job.source_file_id);
    setPreviewStartSec(nextFile && nextFile.id !== job.source_file_id ? null : nextCandidate?.start_sec ?? null);
  }

  function handleSelectCandidate(job: JobSummary, candidate: CandidateClip) {
    setLibraryTab("uploads");
    setSelectedJobId(job.id);
    setSelectedCandidateId(candidate.id);
    setSelectedFileId(job.source_file_id);
    setPreviewStartSec(candidate.start_sec);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-hidden">
        <Skeleton className="h-[170px] w-full rounded-[34px]" />
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

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <PageHeader
        compact
        eyebrow="Project Workspace"
        title={project.name}
        description={`Created ${formatDateTime(project.created_at)}. Keep source media, ranked runs, and exports inside one bounded review workspace.`}
        actions={
          selectedFile ? (
            <Button variant="secondary" asChild>
              <a href={selectedFile.download_url} download>
                <Download className="mr-2 size-4" />
                Download selected
              </a>
            </Button>
          ) : null
        }
      />

      <div className="app-frame flex min-h-0 flex-1 flex-col overflow-hidden rounded-[34px] border border-border/70 p-3 shadow-soft lg:p-4">
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(240px,0.95fr)_minmax(0,1.45fr)_minmax(320px,1.05fr)]">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <FileList
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              contentClassName="px-4 pb-4 pt-0"
              listClassName="pb-1"
              title="Library"
              description={
                libraryTab === "uploads"
                  ? `${uploads.length} source file${uploads.length === 1 ? "" : "s"} ready for review.`
                  : `${outputs.length} generated artifact${outputs.length === 1 ? "" : "s"} in this project.`
              }
              actions={
                <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/80 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={libraryTab === "uploads" ? "default" : "ghost"}
                    onClick={() => setLibraryTab("uploads")}
                  >
                    Uploads
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={libraryTab === "outputs" ? "default" : "ghost"}
                    onClick={() => setLibraryTab("outputs")}
                  >
                    Outputs
                  </Button>
                </div>
              }
              lead={
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="panel-inset rounded-[18px] px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Uploads</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{project.status_summary.upload_count}</p>
                    </div>
                    <div className="panel-inset rounded-[18px] px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Outputs</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{project.status_summary.output_count}</p>
                    </div>
                    <div className="panel-inset rounded-[18px] px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Active</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{activeJobs.length}</p>
                    </div>
                  </div>

                  <div className="panel-inset rounded-[20px] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Focused preview</p>
                    <p className="mt-2 truncate text-sm font-medium text-foreground">{selectedFile?.name || "Nothing selected"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Updated {formatDateTime(project.updated_at)}</p>
                  </div>

                  <UploadDropzone compact uploadProgress={uploadProgress} onFilesSelected={handleUpload} disabled={jobBusy} />
                </div>
              }
              files={libraryFiles}
              selectedFileId={selectedFileId}
              emptyMessage={
                libraryTab === "uploads"
                  ? "Drag raw media into the upload area to get started."
                  : "Generated artifacts will appear here after a run finishes."
              }
              onSelect={handleSelectFile}
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          </div>

          <div className="grid min-h-0 min-w-0 gap-4 overflow-hidden xl:grid-rows-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
            <div className="min-h-0 min-w-0">
              <MediaPreview file={selectedFile} previewStartSec={previewStartSec} />
            </div>

            <div className="min-h-0 min-w-0">
              <CandidateList
                className="h-full"
                sourceJob={candidateReviewJob}
                jobs={sortedJobs}
                selectedCandidate={selectedCandidate}
                selectedCandidateId={selectedCandidateId}
                onSelectCandidate={handleSelectCandidate}
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
            <div className="shrink-0 min-w-0">
              <GeneratePanel
                className="min-w-0"
                uploads={uploads}
                presets={presets}
                defaultPreset={settings.default_preset}
                defaultAggressiveness={settings.cut_aggressiveness}
                defaultCaptions={settings.captions_enabled}
                busy={jobBusy}
                onSubmit={handleCreateJob}
              />
            </div>

            <div className="shrink-0 min-w-0">
                <JobFeed
                  className="max-h-[280px]"
                  jobs={sortedJobs}
                  selectedJobId={selectedJobId}
                  onSelectJob={handleSelectRun}
                  onCancel={(job) => handleCancelJob(job.id)}
                />
            </div>

            <div className="min-h-0 min-w-0">
                <JobInspector
                  className="min-h-[320px]"
                  job={selectedJob}
                  candidate={selectedCandidate}
                  jobs={sortedJobs}
                  files={project.files}
                  onExportCandidate={handleExportCandidate}
                  onPreviewCandidate={handlePreviewCandidate}
                  onSelectFile={handleSelectFile}
                />
            </div>
          </div>
        </div>
      </div>

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
