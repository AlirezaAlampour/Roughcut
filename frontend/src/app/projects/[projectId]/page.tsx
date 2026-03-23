"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { FileList } from "@/components/project/file-list";
import { GeneratePanel } from "@/components/project/generate-panel";
import { JobFeed } from "@/components/project/job-feed";
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
import type { FileItem, JobCreateRequest, PresetConfig, ProjectDetail, SettingsResponse } from "@/lib/types";

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
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);

  async function loadProject() {
    try {
      const result = await api.getProject(projectId);
      setProject(result);
      setSelectedFileId((current) =>
        current && result.files.some((file) => file.id === current) ? current : result.files[0]?.id ?? null
      );
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

  const activeJobs = project?.jobs.filter((job) => job.status === "queued" || job.status === "running") || [];

  useEffect(() => {
    if (activeJobs.length === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadProject();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activeJobs.length, projectId]);

  const uploads = project?.files.filter((file) => file.kind === "upload") || [];
  const outputs = project?.files.filter((file) => file.kind === "output") || [];
  const selectedFile = project?.files.find((file) => file.id === selectedFileId) || project?.files[0] || null;

  async function handleUpload(files: File[]) {
    try {
      setUploadProgress(0);
      const response = await api.uploadFiles(projectId, files, ({ percent }) => setUploadProgress(percent));
      await loadProject();
      setSelectedFileId(response.files[0]?.id || null);
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
      await api.createJob(projectId, payload);
      await loadProject();
      toast.success("Rough-cut job queued.");
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[220px] w-full rounded-[34px]" />
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
          <Skeleton className="h-[740px] rounded-[28px]" />
          <Skeleton className="h-[740px] rounded-[28px]" />
          <Skeleton className="h-[740px] rounded-[28px]" />
        </div>
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Project Workspace"
        title={project.name}
        description={`Created ${formatDateTime(project.created_at)}. Upload source media on the left, preview selections in the center, and run one calm rough-cut flow from the right panel.`}
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

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <UploadDropzone uploadProgress={uploadProgress} onFilesSelected={handleUpload} disabled={jobBusy} />
          <FileList
            title="Uploads"
            description="Raw source files from the browser."
            files={uploads}
            selectedFileId={selectedFileId}
            emptyMessage="Drag raw media into the upload area to get started."
            onSelect={(file) => setSelectedFileId(file.id)}
            onRename={setRenameTarget}
            onDelete={setDeleteTarget}
          />
          <FileList
            title="Outputs"
            description="Rendered rough cuts, transcripts, subtitles, plans, and logs."
            files={outputs}
            selectedFileId={selectedFileId}
            emptyMessage="Generated artifacts will appear here after a run finishes."
            onSelect={(file) => setSelectedFileId(file.id)}
            onRename={setRenameTarget}
            onDelete={setDeleteTarget}
          />
        </div>

        <MediaPreview file={selectedFile} />

        <div className="space-y-6">
          <GeneratePanel
            uploads={uploads}
            presets={presets}
            defaultPreset={settings.default_preset}
            defaultAggressiveness={settings.cut_aggressiveness}
            defaultCaptions={settings.captions_enabled}
            busy={jobBusy}
            onSubmit={handleCreateJob}
          />
          <JobFeed jobs={project.jobs} files={project.files} onCancel={(job) => handleCancelJob(job.id)} />
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
