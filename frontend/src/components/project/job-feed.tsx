"use client";

import { PauseCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, titleizeSlug } from "@/lib/format";
import type { JobSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface JobFeedProps {
  jobs: JobSummary[];
  selectedJobId?: string | null;
  onSelectJob: (job: JobSummary) => void;
  onCancel: (job: JobSummary) => Promise<void> | void;
  className?: string;
}

function runLabel(job: JobSummary) {
  return job.kind === "short_export" ? "Short export" : "Candidate generation";
}

function runMeta(job: JobSummary) {
  if (job.kind === "shorts_candidate_generation") {
    return job.result?.candidate_count ? `${job.result.candidate_count} candidates` : "Awaiting candidates";
  }

  const candidateId = job.payload.candidate_id;
  return typeof candidateId === "string" ? `Candidate ${candidateId.slice(0, 8)}` : "Rendered short";
}

export function JobFeed({ jobs, selectedJobId, onSelectJob, onCancel, className }: JobFeedProps) {
  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="panel-label">Runs</p>
            <CardTitle className="mt-2 text-xl">Recent runs</CardTitle>
          </div>
          <Badge variant="muted">{jobs.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-4">
        {jobs.length === 0 ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            Generate shorts candidates to see runs, export progress, and debug activity here.
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {jobs.map((job) => {
              const selected = job.id === selectedJobId;

              return (
                <button
                  key={job.id}
                  type="button"
                  className={cn(
                    "w-full rounded-[22px] border p-3.5 text-left transition",
                    selected ? "border-primary/30 bg-primary/8" : "border-border/70 bg-card/70 hover:bg-muted/70"
                  )}
                  onClick={() => onSelectJob(job)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={job.status} />
                        <span className="text-sm font-semibold text-foreground">{runLabel(job)}</span>
                      </div>

                      <p className="mt-2 text-sm leading-5 text-muted-foreground">
                        {titleizeSlug(job.preset_id)} · {formatDateTime(job.created_at)}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span>{runMeta(job)}</span>
                        {job.input_type ? <span>{job.input_type === "audio-only" ? "Audio input" : "Video input"}</span> : null}
                        {job.job_mode ? <span>{job.job_mode === "audio-only" ? "Audio mode" : "Video mode"}</span> : null}
                      </div>

                      <p className="mt-2.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                        {job.progress_message || job.current_step || "Queued"}
                      </p>
                    </div>

                    {job.status === "queued" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onCancel(job);
                        }}
                      >
                        <PauseCircle className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  {job.status === "queued" || job.status === "running" ? (
                    <div className="mt-3 space-y-2">
                      <Progress value={job.progress_percent} />
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{job.current_step || "working"}</p>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
