"use client";

import { Download, PauseCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, titleizeSlug } from "@/lib/format";
import type { FileItem, JobSummary } from "@/lib/types";

interface JobFeedProps {
  jobs: JobSummary[];
  files: FileItem[];
  onCancel: (job: JobSummary) => Promise<void> | void;
}

export function JobFeed({ jobs, files, onCancel }: JobFeedProps) {
  const fileMap = new Map(files.map((file) => [file.id, file]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Recent runs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {jobs.length === 0 ? (
          <div className="rounded-[24px] bg-muted/75 p-5 text-sm leading-6 text-muted-foreground">
            No runs yet. Generate a rough cut to see job progress, notes, transcript preview, and downloadable outputs here.
          </div>
        ) : (
          jobs.map((job) => {
            const outputFiles = (job.result?.output_file_ids || [])
              .map((fileId) => fileMap.get(fileId))
              .filter((file): file is FileItem => Boolean(file));

            return (
              <div key={job.id} className="rounded-[26px] border border-border/70 bg-white/70 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={job.status} />
                      <p className="text-sm font-medium text-foreground">{titleizeSlug(job.preset_id)}</p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {job.progress_message || "Queued"} · {formatDateTime(job.created_at)}
                    </p>
                  </div>

                  {job.status === "queued" ? (
                    <Button variant="secondary" size="sm" onClick={() => onCancel(job)}>
                      <PauseCircle className="mr-2 size-4" />
                      Cancel
                    </Button>
                  ) : null}
                </div>

                {job.status === "queued" || job.status === "running" ? (
                  <div className="mt-4 space-y-2">
                    <Progress value={job.progress_percent} />
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {job.current_step || "working"}
                    </p>
                  </div>
                ) : null}

                {job.error_message ? (
                  <div className="mt-4 rounded-[22px] bg-rose-50 p-4 text-sm leading-6 text-rose-700">
                    {job.error_message}
                  </div>
                ) : null}

                {job.result?.notes_for_user?.length ? (
                  <div className="mt-4 rounded-[22px] bg-muted/75 p-4">
                    <p className="panel-label">Edit notes</p>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                      {job.result.notes_for_user.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {job.result?.transcript_preview ? (
                  <div className="mt-4 rounded-[22px] bg-muted/75 p-4">
                    <p className="panel-label">Transcript preview</p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{job.result.transcript_preview}</p>
                  </div>
                ) : null}

                {outputFiles.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {outputFiles.map((file) => (
                      <Button key={file.id} variant="secondary" size="sm" asChild>
                        <a href={file.download_url} download>
                          <Download className="mr-2 size-4" />
                          {file.role === "render" ? "Rough cut" : file.name}
                        </a>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

