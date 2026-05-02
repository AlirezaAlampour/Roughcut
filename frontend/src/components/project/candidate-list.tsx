"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type { CandidateClip, JobSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CandidateListProps {
  sourceJob: JobSummary | null;
  jobs: JobSummary[];
  selectedCandidate?: CandidateClip | null;
  selectedCandidateId?: string | null;
  onSelectCandidate: (job: JobSummary, candidate: CandidateClip) => void;
  className?: string;
}

function payloadString(job: JobSummary, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : null;
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

function candidateTitle(candidate: CandidateClip) {
  return candidate.title.trim() || candidate.hook_text.trim() || "Untitled candidate";
}

function candidateSummary(candidate: CandidateClip) {
  return candidate.hook_text.trim() || candidate.rationale.trim() || candidate.transcript_excerpt.trim() || "Candidate summary unavailable.";
}

export function CandidateList({
  sourceJob,
  jobs,
  selectedCandidate,
  selectedCandidateId,
  onSelectCandidate,
  className
}: CandidateListProps) {
  const candidates = sourceJob?.result?.candidates || [];
  const activeCandidate =
    selectedCandidate ||
    (selectedCandidateId ? candidates.find((candidate) => candidate.id === selectedCandidateId) : null) ||
    candidates[0] ||
    null;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="panel-label">Candidate Review</p>
            <CardTitle className="mt-2 text-xl">Ranked shorts candidates</CardTitle>
          </div>
          <Badge variant="muted">{candidates.length ? `${candidates.length} found` : "Idle"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-4">
        {!sourceJob ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            Select a completed candidate generation run to review clips here.
          </div>
        ) : candidates.length === 0 ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            This run does not have ranked candidates yet.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {activeCandidate ? (
              <div className="rounded-[24px] border border-primary/20 bg-primary/8 p-4 shadow-[0_18px_40px_-34px_rgba(77,58,35,0.45)]">
                <div className="flex items-start gap-4">
                  <div className="flex w-[72px] shrink-0 flex-col items-center rounded-[22px] bg-primary px-3 py-3 text-primary-foreground">
                    <span className="text-[11px] uppercase tracking-[0.18em] opacity-75">Score</span>
                    <span className="mt-1 text-2xl font-semibold leading-none">{Math.round(activeCandidate.score_total)}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{candidateTitle(activeCandidate)}</p>
                      {activeCandidate.duplicate_group ? <Badge variant="muted">duplicate {activeCandidate.duplicate_group}</Badge> : null}
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {formatDuration(activeCandidate.end_sec - activeCandidate.start_sec)} · {formatTimestamp(activeCandidate.start_sec, 1)} -{" "}
                      {formatTimestamp(activeCandidate.end_sec, 1)}
                    </p>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{candidateSummary(activeCandidate)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeCandidate.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="muted">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {activeCandidate.score_breakdown ? (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          <Sparkles className="mr-1 inline size-3" />
                          Hook {activeCandidate.score_breakdown.hook_strength.toFixed(1)}
                        </span>
                        <span>Contained {activeCandidate.score_breakdown.self_containedness.toFixed(1)}</span>
                        <span>Payoff {activeCandidate.score_breakdown.payoff_clarity.toFixed(1)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 px-1">
              <p className="panel-label">Candidate queue</p>
              <p className="text-xs text-muted-foreground">Select a ranked clip to sync preview and inspector.</p>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {candidates.map((candidate, index) => {
                const exportJobs = candidateExportJobs(jobs, sourceJob.id, candidate.id);
                const activeExportJob = exportJobs.find((job) => job.status === "queued" || job.status === "running");
                const rendered = exportJobs.some((job) => job.status === "completed" && job.result?.output_file_ids?.length);
                const selected = selectedCandidateId === candidate.id;

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={cn(
                      "w-full rounded-[22px] border px-3.5 py-3.5 text-left transition",
                      selected
                        ? "border-primary/30 bg-primary/8 shadow-[0_18px_40px_-34px_rgba(77,58,35,0.55)]"
                        : "border-border/70 bg-card/70 hover:bg-muted/70"
                    )}
                    onClick={() => onSelectCandidate(sourceJob, candidate)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-muted text-sm font-semibold text-foreground">
                        #{index + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{candidateTitle(candidate)}</p>
                          <span className="text-sm font-semibold text-foreground">{Math.round(candidate.score_total)}</span>
                          {rendered ? <Badge variant="success">Rendered</Badge> : null}
                          {activeExportJob ? <Badge variant="warning">Exporting</Badge> : null}
                        </div>

                        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {formatDuration(candidate.end_sec - candidate.start_sec)} · {formatTimestamp(candidate.start_sec, 1)} -{" "}
                          {formatTimestamp(candidate.end_sec, 1)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{candidateSummary(candidate)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
