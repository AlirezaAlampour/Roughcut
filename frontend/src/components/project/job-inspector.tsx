"use client";

import { useState } from "react";
import { Download, FileText, FileVideo2, Loader2, MessageSquareText, Play } from "lucide-react";

import { JobTracePanel } from "@/components/project/job-trace-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatDuration, formatTimestamp, titleizeSlug } from "@/lib/format";
import type { CandidateClip, FileItem, JobSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface JobInspectorProps {
  job: JobSummary | null;
  candidate: CandidateClip | null;
  jobs: JobSummary[];
  files: FileItem[];
  onExportCandidate: (job: JobSummary, candidate: CandidateClip) => Promise<void> | void;
  onPreviewCandidate: (job: JobSummary, candidate: CandidateClip) => void;
  onSelectFile: (file: FileItem) => void;
  className?: string;
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

function outputFilesForJob(job: JobSummary | undefined, files: FileItem[]) {
  if (!job?.result?.output_file_ids?.length) {
    return [];
  }
  const fileMap = new Map(files.map((file) => [file.id, file]));
  return job.result.output_file_ids.map((fileId) => fileMap.get(fileId)).filter((file): file is FileItem => Boolean(file));
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

function candidateTranscript(candidate: CandidateClip) {
  const transcript = candidate.subtitle_segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return transcript || candidate.transcript_excerpt.trim() || "Transcript preview not available for this clip.";
}

function formatSrtTimestamp(value: number) {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
}

function buildCandidateSrt(candidate: CandidateClip) {
  return candidate.subtitle_segments
    .map((segment, index) =>
      [index + 1, `${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}`, segment.text.trim()].join(
        "\n"
      )
    )
    .join("\n\n");
}

function downloadTextFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function candidateDownloadName(candidate: CandidateClip, suffix: string) {
  return `roughcut-${candidate.id}${suffix}`;
}

function modeLabel(value: JobSummary["job_mode"] | JobSummary["input_type"]) {
  if (!value) {
    return "Pending";
  }
  return value === "audio-only" ? "Audio only" : "Video";
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-inset rounded-[20px] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-foreground">{value}</p>
    </div>
  );
}

export function JobInspector({
  job,
  candidate,
  jobs,
  files,
  onExportCandidate,
  onPreviewCandidate,
  onSelectFile,
  className
}: JobInspectorProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const fallbackCandidate = job ? candidateFromPayload(job) : null;
  const activeCandidate = candidate || fallbackCandidate;
  const candidateSourceJobId =
    job?.kind === "short_export" ? payloadString(job, "source_candidate_job_id") || null : job?.id || null;
  const candidateSourceJob =
    (candidateSourceJobId ? jobs.find((item) => item.id === candidateSourceJobId) : null) ||
    (job?.kind === "shorts_candidate_generation" ? job : null);
  const exportJobs =
    candidateSourceJob && activeCandidate ? candidateExportJobs(jobs, candidateSourceJob.id, activeCandidate.id) : [];
  const activeExportJob = exportJobs.find((item) => item.status === "queued" || item.status === "running");
  const completedExportJob = exportJobs.find((item) => item.status === "completed" && item.result?.output_file_ids?.length);
  const exportFiles = outputFilesForJob(completedExportJob, files);
  const clipFile = exportFiles.find((file) => file.role === "candidate_clip");
  const captionFile =
    exportFiles.find((file) => file.role === "candidate_captions_srt") ||
    exportFiles.find((file) => file.role === "candidate_captions_vtt") ||
    exportFiles.find((file) => file.role === "candidate_captions_ass");
  const notes = job?.result?.notes_for_user || [];
  const hasTranscript = Boolean(
    activeCandidate?.subtitle_segments.length || activeCandidate?.transcript_excerpt.trim() || job?.result?.transcript_preview
  );

  return (
    <>
      <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="panel-label">Inspector</p>
              <CardTitle className="mt-2 text-xl">Run and candidate detail</CardTitle>
            </div>
            <StatusBadge status={job?.status} />
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-4">
          {!job ? (
            <div className="panel-inset flex min-h-[260px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
              Choose a run to inspect its candidate details, transcript context, and trace.
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
                <div className="rounded-[24px] border border-border/70 bg-card/75 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={job.status} />
                    <Badge variant="muted">{job.kind === "short_export" ? "Short export" : "Candidate generation"}</Badge>
                  </div>
                  <p className="mt-3 text-base font-semibold text-foreground">{titleizeSlug(job.preset_id)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {job.progress_message || job.current_step || "Queued"} · {formatDateTime(job.created_at)}
                  </p>
                  {(job.status === "queued" || job.status === "running") && (
                    <div className="mt-4 space-y-2">
                      <Progress value={job.progress_percent} />
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{job.current_step || "working"}</p>
                    </div>
                  )}
                  {job.error_message ? (
                    <div className="mt-4 rounded-[20px] bg-rose-500/12 px-4 py-3 text-sm leading-6 text-rose-700 dark:text-rose-100">
                      {job.error_message}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <MetaCard label="Input" value={modeLabel(job.input_type)} />
                    <MetaCard label="Mode" value={modeLabel(job.job_mode)} />
                    <MetaCard
                      label="Captions"
                      value={job.captions_enabled ? "Burned into exports" : "Export without burn-in"}
                    />
                    <MetaCard
                      label={job.kind === "short_export" ? "Outputs" : "Candidates"}
                      value={
                        job.kind === "short_export"
                          ? `${job.result?.output_file_ids?.length ?? 0} file${job.result?.output_file_ids?.length === 1 ? "" : "s"}`
                          : `${job.result?.candidate_count ?? 0} ranked`
                      }
                    />
                  </div>

                  {notes.length ? (
                    <div className="panel-inset mt-4 rounded-[20px] px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Run notes</p>
                      <ul className="mt-2 space-y-1 text-sm leading-6 text-foreground">
                        {notes.slice(0, 2).map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                      {notes.length > 2 ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">+{notes.length - 2} more notes in trace output</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {activeCandidate ? (
                  <div className="rounded-[24px] border border-border/70 bg-card/75 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{Math.round(activeCandidate.score_total)} score</Badge>
                          {clipFile ? <Badge variant="success">Rendered</Badge> : null}
                          {activeCandidate.duplicate_group ? <Badge variant="muted">duplicate {activeCandidate.duplicate_group}</Badge> : null}
                        </div>
                        <h3 className="mt-3 text-lg font-semibold leading-7 text-foreground">{candidateTitle(activeCandidate)}</h3>
                        {candidateHook(activeCandidate) ? (
                          <p className="mt-2 text-sm font-medium leading-6 text-foreground">{candidateHook(activeCandidate)}</p>
                        ) : null}
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">{candidateSummary(activeCandidate)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (clipFile) {
                              onSelectFile(clipFile);
                              return;
                            }
                            if (candidateSourceJob) {
                              onPreviewCandidate(candidateSourceJob, activeCandidate);
                            }
                          }}
                        >
                          <Play className="mr-2 size-4" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          disabled={Boolean(activeExportJob) || !candidateSourceJob}
                          onClick={() => {
                            if (candidateSourceJob) {
                              void onExportCandidate(candidateSourceJob, activeCandidate);
                            }
                          }}
                        >
                          {activeExportJob ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileVideo2 className="mr-2 size-4" />}
                          {activeExportJob ? "Exporting" : clipFile ? "Re-export" : "Export"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <MetaCard label="Duration" value={formatDuration(activeCandidate.end_sec - activeCandidate.start_sec)} />
                      <MetaCard
                        label="Clip range"
                        value={`${formatTimestamp(activeCandidate.start_sec, 1)} - ${formatTimestamp(activeCandidate.end_sec, 1)}`}
                      />
                      <MetaCard label="Preset" value={titleizeSlug(job.preset_id)} />
                      <MetaCard label="Export status" value={clipFile ? "Clip ready" : activeExportJob ? "Rendering" : "Not exported"} />
                    </div>

                    {activeCandidate.tags.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {activeCandidate.tags.map((tag) => (
                          <Badge key={tag} variant="muted">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {activeCandidate.score_breakdown ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <MetaCard label="Hook" value={activeCandidate.score_breakdown.hook_strength.toFixed(1)} />
                        <MetaCard label="Contained" value={activeCandidate.score_breakdown.self_containedness.toFixed(1)} />
                        <MetaCard label="Payoff" value={activeCandidate.score_breakdown.payoff_clarity.toFixed(1)} />
                        <MetaCard label="Penalty" value={activeCandidate.score_breakdown.verbosity_penalty.toFixed(1)} />
                      </div>
                    ) : null}

                    {activeExportJob ? (
                      <div className="mt-4 space-y-2">
                        <Progress value={activeExportJob.progress_percent || 0} />
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {activeExportJob.progress_message || "Queued for export"}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {clipFile ? (
                        <Button variant="secondary" size="sm" asChild>
                          <a href={clipFile.download_url} download>
                            <Download className="mr-2 size-4" />
                            Download clip
                          </a>
                        </Button>
                      ) : null}

                      {captionFile ? (
                        <Button variant="secondary" size="sm" asChild>
                          <a href={captionFile.download_url} download>
                            <FileText className="mr-2 size-4" />
                            Download captions
                          </a>
                        </Button>
                      ) : activeCandidate.subtitle_segments.length ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            downloadTextFile(
                              candidateDownloadName(activeCandidate, "-captions.srt"),
                              buildCandidateSrt(activeCandidate),
                              "text/plain"
                            )
                          }
                        >
                          <FileText className="mr-2 size-4" />
                          Download captions
                        </Button>
                      ) : null}

                      {hasTranscript ? (
                        <Button variant="secondary" size="sm" onClick={() => setTranscriptOpen(true)}>
                          <MessageSquareText className="mr-2 size-4" />
                          Transcript
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="panel-inset rounded-[24px] px-5 py-6 text-sm leading-6 text-muted-foreground">
                    This run does not expose a candidate detail panel. Select a completed candidate generation run to inspect clips.
                  </div>
                )}
              </div>

              <div className="mt-4 shrink-0">
                <JobTracePanel job={job} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {job && hasTranscript ? (
        <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
          <DialogContent className="flex max-h-[85vh] w-[min(94vw,880px)] flex-col overflow-hidden p-0">
            <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <DialogTitle>{activeCandidate ? candidateTitle(activeCandidate) : "Transcript preview"}</DialogTitle>
              <DialogDescription>
                Review transcript context without expanding the inspector rail.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto px-6 py-5">
              {activeCandidate?.subtitle_segments.length ? (
                <div className="space-y-3">
                  {activeCandidate.subtitle_segments.map((segment, index) => (
                    <div key={`${activeCandidate.id}-${index}`} className="panel-inset rounded-[18px] px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {formatTimestamp(segment.start, 1)} - {formatTimestamp(segment.end, 1)}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground">{segment.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-inset rounded-[18px] px-4 py-4">
                  <p className="text-sm leading-6 text-foreground">
                    {activeCandidate ? candidateTranscript(activeCandidate) : job.result?.transcript_preview}
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
