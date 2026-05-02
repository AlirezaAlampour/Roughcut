"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clapperboard, Play, Search, Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type { CandidateClip, FileItem, JobSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CandidateListProps {
  sourceJob: JobSummary | null;
  jobs: JobSummary[];
  sourceFile?: FileItem | null;
  selectedCandidate?: CandidateClip | null;
  selectedCandidateId?: string | null;
  onSelectCandidate: (job: JobSummary, candidate: CandidateClip) => void;
  onPreviewCandidate?: (job: JobSummary, candidate: CandidateClip) => void;
  onExportCandidate?: (job: JobSummary, candidate: CandidateClip) => Promise<void> | void;
  onOpenDetails?: (job: JobSummary, candidate: CandidateClip) => void;
  className?: string;
}

type CandidateFilter = "all" | "rendered" | "fresh";
type CandidateSort = "rank" | "score" | "shortest" | "longest" | "earliest";

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

function candidateHook(candidate: CandidateClip) {
  return candidate.hook_text.trim() || candidate.title.trim() || "";
}

function candidateSummary(candidate: CandidateClip) {
  return candidate.rationale.trim() || candidate.transcript_excerpt.trim() || candidate.hook_text.trim() || "Candidate summary unavailable.";
}

function matchesQuery(candidate: CandidateClip, query: string) {
  if (!query.trim()) {
    return true;
  }

  const haystack = [candidateTitle(candidate), candidate.hook_text, candidate.rationale, candidate.transcript_excerpt, ...candidate.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function CandidatePreviewFrame({
  candidate,
  previewUrl,
  isVideo,
  active
}: {
  candidate: CandidateClip;
  previewUrl: string | null;
  isVideo: boolean;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!active || !videoRef.current || !previewUrl || !isVideo) {
      return;
    }

    const video = videoRef.current;
    const previewStart = Math.max(0, candidate.start_sec);
    const previewEnd = Math.max(previewStart + 1.6, Math.min(candidate.end_sec, previewStart + 3.6));

    const seekAndPlay = () => {
      try {
        video.currentTime = previewStart;
      } catch {
        return;
      }
      void video.play().catch(() => {
        // Muted hover previews may still be blocked; the still frame remains useful.
      });
    };

    const handleLoadedMetadata = () => seekAndPlay();
    const handleTimeUpdate = () => {
      if (video.currentTime >= previewEnd) {
        try {
          video.currentTime = previewStart;
        } catch {
          return;
        }
        void video.play().catch(() => {
          // Ignore autoplay loop interruptions.
        });
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    if (video.readyState >= 1) {
      seekAndPlay();
    }

    return () => {
      video.pause();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [active, candidate.end_sec, candidate.start_sec, isVideo, previewUrl]);

  if (active && previewUrl && isVideo) {
    return (
      <video
        ref={videoRef}
        key={`${candidate.id}-${candidate.start_sec}`}
        autoPlay
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        src={previewUrl}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full items-end overflow-hidden bg-[radial-gradient(circle_at_top,rgba(206,188,155,0.22),transparent_42%),linear-gradient(180deg,rgba(27,21,14,0.18),rgba(13,11,9,0.88))] p-4">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_38%)]" />
      <div className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/72">
        {isVideo ? "Hover preview" : "Audio clip"}
      </div>
      <div className="relative flex w-full items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="line-clamp-3 max-w-[13rem] text-base font-semibold leading-6 text-white">{candidateHook(candidate)}</p>
        </div>
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-white/78">
          {isVideo ? <Clapperboard className="size-5" /> : <Volume2 className="size-5" />}
        </div>
      </div>
    </div>
  );
}

export function CandidateList({
  sourceJob,
  jobs,
  sourceFile,
  selectedCandidate,
  selectedCandidateId,
  onSelectCandidate,
  onPreviewCandidate,
  onExportCandidate,
  onOpenDetails,
  className
}: CandidateListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [sortBy, setSortBy] = useState<CandidateSort>("rank");
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);

  const candidates = sourceJob?.result?.candidates || [];
  const previewUrl = sourceFile?.preview_url || sourceFile?.download_url || null;
  const hasVideoPreview = Boolean(sourceFile?.mime_type?.startsWith("video/"));

  const renderedCandidateIds = new Set(
    sourceJob
      ? candidates
          .filter((candidate) =>
            candidateExportJobs(jobs, sourceJob.id, candidate.id).some(
              (job) => job.status === "completed" && Boolean(job.result?.output_file_ids?.length)
            )
          )
          .map((candidate) => candidate.id)
      : []
  );

  const filteredCandidates = [...candidates]
    .filter((candidate) => matchesQuery(candidate, query))
    .filter((candidate) => {
      if (filter === "rendered") {
        return renderedCandidateIds.has(candidate.id);
      }
      if (filter === "fresh") {
        return !renderedCandidateIds.has(candidate.id);
      }
      return true;
    })
    .sort((left, right) => {
      if (sortBy === "score") {
        return right.score_total - left.score_total;
      }
      if (sortBy === "shortest") {
        return left.end_sec - left.start_sec - (right.end_sec - right.start_sec);
      }
      if (sortBy === "longest") {
        return right.end_sec - right.start_sec - (left.end_sec - left.start_sec);
      }
      if (sortBy === "earliest") {
        return left.start_sec - right.start_sec;
      }
      return candidates.findIndex((candidate) => candidate.id === left.id) - candidates.findIndex((candidate) => candidate.id === right.id);
    });

  const activeCandidate =
    selectedCandidate ||
    (selectedCandidateId ? candidates.find((candidate) => candidate.id === selectedCandidateId) : null) ||
    filteredCandidates[0] ||
    candidates[0] ||
    null;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="border-b border-border/60 pb-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="panel-label">Clip Browser</p>
              <CardTitle className="mt-2 text-xl sm:text-2xl">Ranked candidates gallery</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{candidates.length ? `${filteredCandidates.length}/${candidates.length}` : "Idle"}</Badge>
              {activeCandidate ? <Badge>{Math.round(activeCandidate.score_total)} focus score</Badge> : null}
            </div>
          </div>

          {sourceJob ? (
            <div className="rounded-[24px] border border-border/70 bg-card/70 p-3.5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative w-full xl:max-w-[340px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search hooks, rationale, transcript"
                    className="h-10 rounded-[18px] border-border/70 bg-background/70 pl-10"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 p-1">
                    <Button size="sm" variant={filter === "all" ? "default" : "ghost"} onClick={() => setFilter("all")}>
                      All
                    </Button>
                    <Button size="sm" variant={filter === "fresh" ? "default" : "ghost"} onClick={() => setFilter("fresh")}>
                      Fresh
                    </Button>
                    <Button size="sm" variant={filter === "rendered" ? "default" : "ghost"} onClick={() => setFilter("rendered")}>
                      Rendered
                    </Button>
                  </div>

                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as CandidateSort)}>
                    <SelectTrigger className="h-10 w-[170px] rounded-[18px] border-border/70 bg-background/70">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rank">Sort: rank</SelectItem>
                      <SelectItem value="score">Sort: score</SelectItem>
                      <SelectItem value="shortest">Sort: shortest</SelectItem>
                      <SelectItem value="longest">Sort: longest</SelectItem>
                      <SelectItem value="earliest">Sort: earliest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4">
        {!sourceJob ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            Select a completed candidate generation run to review clips here.
          </div>
        ) : candidates.length === 0 ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            This run does not have ranked candidates yet.
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="panel-inset flex min-h-[220px] flex-1 items-center justify-center rounded-[24px] px-5 text-center text-sm leading-6 text-muted-foreground">
            No candidates match the current search or filter.
          </div>
        ) : (
          <div className="pr-1">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {filteredCandidates.map((candidate, index) => {
                const exportJobs = candidateExportJobs(jobs, sourceJob.id, candidate.id);
                const activeExportJob = exportJobs.find((job) => job.status === "queued" || job.status === "running");
                const rendered = exportJobs.some((job) => job.status === "completed" && Boolean(job.result?.output_file_ids?.length));
                const selected = selectedCandidateId === candidate.id;
                const showPreview = hasVideoPreview && previewUrl && (selected || hoveredCandidateId === candidate.id);
                const duration = candidate.end_sec - candidate.start_sec;

                return (
                  <div
                    key={candidate.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group flex w-full flex-col rounded-[28px] border p-3 text-left transition duration-200",
                      selected
                        ? "border-primary/30 bg-primary/8 shadow-[0_26px_64px_-42px_rgba(21,17,12,0.78)]"
                        : "border-border/70 bg-card/72 hover:border-border hover:bg-card/88 hover:shadow-[0_24px_56px_-44px_rgba(21,17,12,0.82)]"
                    )}
                    onClick={() => onSelectCandidate(sourceJob, candidate)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectCandidate(sourceJob, candidate);
                      }
                    }}
                    onMouseEnter={() => setHoveredCandidateId(candidate.id)}
                    onMouseLeave={() => setHoveredCandidateId((current) => (current === candidate.id ? null : current))}
                  >
                    <div className="relative overflow-hidden rounded-[24px] border border-white/6 bg-black/60">
                      <div className="aspect-[9/16]">
                        <CandidatePreviewFrame
                          candidate={candidate}
                          previewUrl={previewUrl}
                          isVideo={hasVideoPreview}
                          active={Boolean(showPreview)}
                        />
                      </div>

                      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3.5">
                        <div className="rounded-full border border-white/10 bg-black/38 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/88">
                          #{index + 1}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white px-3 py-1 text-sm font-semibold text-neutral-950">
                          {Math.round(candidate.score_total)}
                        </div>
                      </div>

                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/88 via-black/48 to-transparent px-4 pb-4 pt-12">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/70">
                          <span>{formatDuration(duration)}</span>
                          <span>{formatTimestamp(candidate.start_sec, 1)}</span>
                          {rendered ? <span className="rounded-full border border-emerald-400/30 bg-emerald-400/14 px-2 py-0.5 text-emerald-100">Ready</span> : null}
                          {activeExportJob ? (
                            <span className="rounded-full border border-amber-300/25 bg-amber-300/12 px-2 py-0.5 text-amber-50">Exporting</span>
                          ) : null}
                        </div>
                        <p className="mt-2 line-clamp-2 text-base font-semibold leading-6 text-white">{candidateTitle(candidate)}</p>
                      </div>
                    </div>

                    <div className="mt-4 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {candidate.duplicate_group ? <Badge variant="muted">duplicate {candidate.duplicate_group}</Badge> : null}
                        {candidate.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="muted">
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-foreground">{candidateHook(candidate) || candidateTitle(candidate)}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{candidateSummary(candidate)}</p>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={selected ? "default" : "secondary"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectCandidate(sourceJob, candidate);
                            onPreviewCandidate?.(sourceJob, candidate);
                          }}
                        >
                          <Play className="mr-2 size-4" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectCandidate(sourceJob, candidate);
                            onOpenDetails?.(sourceJob, candidate);
                          }}
                        >
                          <ArrowUpRight className="mr-2 size-4" />
                          Details
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(activeExportJob) || !onExportCandidate}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectCandidate(sourceJob, candidate);
                            void onExportCandidate?.(sourceJob, candidate);
                          }}
                        >
                          Export
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
