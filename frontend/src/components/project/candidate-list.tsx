"use client";

import { Download, FileVideo2, Loader2, Play, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/format";
import type { CandidateClip, FileItem, JobSummary } from "@/lib/types";

interface CandidateListProps {
  sourceJob: JobSummary;
  jobs: JobSummary[];
  files: FileItem[];
  onExport: (job: JobSummary, candidate: CandidateClip) => Promise<void> | void;
  onPreviewSource: (job: JobSummary, candidate: CandidateClip) => void;
  onSelectFile: (file: FileItem) => void;
}

function payloadString(job: JobSummary, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : null;
}

function candidateExportJob(jobs: JobSummary[], sourceJobId: string, candidateId: string) {
  return jobs.find(
    (job) =>
      job.kind === "short_export" &&
      payloadString(job, "source_candidate_job_id") === sourceJobId &&
      payloadString(job, "candidate_id") === candidateId
  );
}

function outputFilesForJob(job: JobSummary | undefined, files: FileItem[]) {
  if (!job?.result?.output_file_ids?.length) {
    return [];
  }
  const fileMap = new Map(files.map((file) => [file.id, file]));
  return job.result.output_file_ids.map((fileId) => fileMap.get(fileId)).filter((file): file is FileItem => Boolean(file));
}

export function CandidateList({ sourceJob, jobs, files, onExport, onPreviewSource, onSelectFile }: CandidateListProps) {
  const candidates = sourceJob.result?.candidates || [];

  if (!candidates.length) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="panel-label">Ranked shorts candidates</p>
        <Badge variant="muted">{candidates.length} found</Badge>
      </div>

      {candidates.map((candidate, index) => {
        const exportJob = candidateExportJob(jobs, sourceJob.id, candidate.id);
        const exportFiles = outputFilesForJob(exportJob, files);
        const clipFile = exportFiles.find((file) => file.role === "candidate_clip");
        const activeExport = exportJob?.status === "queued" || exportJob?.status === "running";

        return (
          <div key={candidate.id} className="rounded-[22px] border border-border/70 bg-white/85 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{`#${index + 1}`}</Badge>
                  <Badge variant="muted">{Math.round(candidate.score_total)} score</Badge>
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {formatDuration(candidate.end_sec - candidate.start_sec)} · {candidate.start_sec.toFixed(1)}s
                  </span>
                </div>
                <h4 className="mt-3 text-base font-semibold leading-6 text-foreground">{candidate.title}</h4>
                {candidate.hook_text ? (
                  <p className="mt-2 text-sm font-medium leading-6 text-foreground">{candidate.hook_text}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onPreviewSource(sourceJob, candidate)}>
                  <Play className="mr-2 size-4" />
                  Source
                </Button>
                {clipFile ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onSelectFile(clipFile)}>
                      <Play className="mr-2 size-4" />
                      Preview
                    </Button>
                    <Button variant="secondary" size="sm" asChild>
                      <a href={clipFile.download_url} download>
                        <Download className="mr-2 size-4" />
                        MP4
                      </a>
                    </Button>
                  </>
                ) : (
                  <Button size="sm" disabled={activeExport} onClick={() => onExport(sourceJob, candidate)}>
                    {activeExport ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileVideo2 className="mr-2 size-4" />}
                    {activeExport ? "Exporting" : "Export"}
                  </Button>
                )}
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-muted-foreground">{candidate.rationale}</p>
            <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">{candidate.transcript_excerpt}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {candidate.tags.map((tag) => (
                <Badge key={tag} variant="muted">
                  {tag}
                </Badge>
              ))}
              {candidate.duplicate_group ? <Badge variant="muted">duplicate: {candidate.duplicate_group}</Badge> : null}
            </div>

            {activeExport ? (
              <div className="mt-4 space-y-2">
                <Progress value={exportJob?.progress_percent || 0} />
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {exportJob?.progress_message || "Queued for export"}
                </p>
              </div>
            ) : null}

            {candidate.score_breakdown ? (
              <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <span>
                  <Sparkles className="mr-1 inline size-3" />
                  Hook {candidate.score_breakdown.hook_strength.toFixed(1)}
                </span>
                <span>Contained {candidate.score_breakdown.self_containedness.toFixed(1)}</span>
                <span>Payoff {candidate.score_breakdown.payoff_clarity.toFixed(1)}</span>
                <span>Penalty {candidate.score_breakdown.verbosity_penalty.toFixed(1)}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
