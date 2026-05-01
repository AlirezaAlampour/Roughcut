"use client";

import { useState } from "react";
import { Download, FileText, FileVideo2, Loader2, MessageSquareText, Play, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatDuration, formatTimestamp } from "@/lib/format";
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

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-border/60 bg-white/75 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-foreground">{value}</p>
    </div>
  );
}

export function CandidateList({ sourceJob, jobs, files, onExport, onPreviewSource, onSelectFile }: CandidateListProps) {
  const candidates = sourceJob.result?.candidates || [];
  const [transcriptCandidateId, setTranscriptCandidateId] = useState<string | null>(null);

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
        const exportJobs = candidateExportJobs(jobs, sourceJob.id, candidate.id);
        const activeExportJob = exportJobs.find((job) => job.status === "queued" || job.status === "running");
        const completedExportJob = exportJobs.find((job) => job.status === "completed" && job.result?.output_file_ids?.length);
        const exportFiles = outputFilesForJob(completedExportJob, files);
        const clipFile = exportFiles.find((file) => file.role === "candidate_clip");
        const captionFile =
          exportFiles.find((file) => file.role === "candidate_captions_srt") ||
          exportFiles.find((file) => file.role === "candidate_captions_vtt") ||
          exportFiles.find((file) => file.role === "candidate_captions_ass");
        const activeExport = Boolean(activeExportJob);
        const title = candidateTitle(candidate);
        const hook = candidateHook(candidate);
        const transcript = candidateTranscript(candidate);
        const durationLabel = formatDuration(candidate.end_sec - candidate.start_sec);
        const rangeLabel = `${formatTimestamp(candidate.start_sec, 1)} - ${formatTimestamp(candidate.end_sec, 1)}`;
        const rationale = candidate.rationale.trim();

        return (
          <div
            key={candidate.id}
            className="rounded-[26px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,242,234,0.92))] p-5 shadow-[0_18px_50px_-34px_rgba(77,58,35,0.35)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{`#${index + 1}`}</Badge>
                  {clipFile ? <Badge variant="success">Rendered</Badge> : null}
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Shorts candidate</span>
                </div>
                <h4 className="mt-3 text-lg font-semibold leading-7 text-foreground">{title}</h4>
              </div>

              <div className="min-w-[88px] rounded-[22px] bg-primary px-4 py-3 text-center text-primary-foreground shadow-soft">
                <p className="text-[11px] uppercase tracking-[0.18em] text-primary-foreground/80">Score</p>
                <p className="mt-1 text-3xl font-semibold leading-none">{Math.round(candidate.score_total)}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetaCard label="Duration" value={durationLabel} />
              <MetaCard label="Clip Range" value={rangeLabel} />
            </div>

            {hook ? (
              <div className="mt-4 rounded-[22px] border border-border/60 bg-[#f6f1e8] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Top hook</p>
                <p className="mt-2 line-clamp-3 text-sm font-semibold leading-6 text-foreground">{hook}</p>
              </div>
            ) : null}

            {rationale ? (
              <div className="mt-4 rounded-[22px] border border-border/60 bg-white/70 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Why it scored well</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{rationale}</p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {candidate.tags.map((tag) => (
                <Badge key={tag} variant="muted">
                  {tag}
                </Badge>
              ))}
              {candidate.duplicate_group ? <Badge variant="muted">duplicate: {candidate.duplicate_group}</Badge> : null}
            </div>

            {activeExport ? (
              <div className="mt-4 space-y-2">
                <Progress value={activeExportJob?.progress_percent || 0} />
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {activeExportJob?.progress_message || "Queued for export"}
                </p>
              </div>
            ) : null}

            {candidate.score_breakdown ? (
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>
                  <Sparkles className="mr-1 inline size-3" />
                  Hook {candidate.score_breakdown.hook_strength.toFixed(1)}
                </span>
                <span>Contained {candidate.score_breakdown.self_containedness.toFixed(1)}</span>
                <span>Payoff {candidate.score_breakdown.payoff_clarity.toFixed(1)}</span>
                <span>Penalty {candidate.score_breakdown.verbosity_penalty.toFixed(1)}</span>
              </div>
            ) : null}

            <Separator className="mt-5" />

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (clipFile) {
                    onSelectFile(clipFile);
                    return;
                  }
                  onPreviewSource(sourceJob, candidate);
                }}
              >
                <Play className="mr-2 size-4" />
                Preview
              </Button>

              <Button variant="secondary" size="sm" onClick={() => setTranscriptCandidateId(candidate.id)}>
                <MessageSquareText className="mr-2 size-4" />
                View transcript
              </Button>

              {clipFile ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={clipFile.download_url} download>
                    <Download className="mr-2 size-4" />
                    Download clip
                  </a>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  <Download className="mr-2 size-4" />
                  Download clip
                </Button>
              )}

              {captionFile ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={captionFile.download_url} download>
                    <FileText className="mr-2 size-4" />
                    Download captions
                  </a>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={candidate.subtitle_segments.length === 0}
                  onClick={() =>
                    downloadTextFile(candidateDownloadName(candidate, "-captions.srt"), buildCandidateSrt(candidate), "text/plain")
                  }
                >
                  <FileText className="mr-2 size-4" />
                  Download captions
                </Button>
              )}

              <Button size="sm" disabled={activeExport} onClick={() => onExport(sourceJob, candidate)}>
                {activeExport ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileVideo2 className="mr-2 size-4" />}
                {activeExport ? "Exporting" : clipFile ? "Re-export short" : "Export short"}
              </Button>
            </div>

            {!clipFile ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Preview uses the source clip until you export. Clip download unlocks after the first render.
              </p>
            ) : null}

            <Dialog
              open={transcriptCandidateId === candidate.id}
              onOpenChange={(open) => setTranscriptCandidateId(open ? candidate.id : null)}
            >
              <DialogContent className="w-[min(92vw,760px)] overflow-hidden p-0">
                <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,241,232,0.92))] px-6 py-6">
                  <DialogHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{`#${index + 1}`}</Badge>
                      <Badge variant="muted">{Math.round(candidate.score_total)} score</Badge>
                    </div>
                    <DialogTitle className="mt-3 pr-8 text-2xl leading-8">{title}</DialogTitle>
                    <DialogDescription>
                      Clip-local transcript when available, with source range shown for quick review.
                    </DialogDescription>
                  </DialogHeader>
                </div>

                <div className="grid gap-3 px-6 py-5 sm:grid-cols-3">
                  <MetaCard label="Duration" value={durationLabel} />
                  <MetaCard label="Clip Range" value={rangeLabel} />
                  <MetaCard label="Hook Source" value={candidate.hook_text.trim() ? "Planner hook text" : "Title fallback"} />
                </div>

                <Separator />

                <div className="max-h-[58vh] space-y-4 overflow-y-auto px-6 py-5">
                  {hook ? (
                    <div className="rounded-[22px] border border-border/60 bg-[#f6f1e8] px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rendered hook block</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-foreground">{hook}</p>
                    </div>
                  ) : null}

                  {candidate.subtitle_segments.length ? (
                    <div className="space-y-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Transcript relative to clip start</p>
                      {candidate.subtitle_segments.map((segment, segmentIndex) => (
                        <div key={`${candidate.id}-${segmentIndex}`} className="rounded-[20px] border border-border/60 bg-white/75 px-4 py-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {formatTimestamp(segment.start, 1)} - {formatTimestamp(segment.end, 1)}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-foreground">{segment.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-border/60 bg-white/75 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Transcript excerpt</p>
                      <p className="mt-2 text-sm leading-6 text-foreground">{transcript}</p>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        );
      })}
    </div>
  );
}
