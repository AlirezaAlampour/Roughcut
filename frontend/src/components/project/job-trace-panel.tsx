"use client";

import { useState } from "react";
import { Activity, AlertTriangle, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatDateTime, titleizeSlug } from "@/lib/format";
import type { JobSummary, JobTraceResponse, TraceEvent } from "@/lib/types";

interface JobTracePanelProps {
  job: JobSummary;
}

function severityVariant(severity: TraceEvent["severity"]) {
  if (severity === "error") {
    return "danger";
  }
  if (severity === "warning") {
    return "warning";
  }
  return severity === "info" ? "default" : "muted";
}

function artifactLabel(filename: string) {
  if (filename === "planner-prompt.txt") {
    return "Planner prompt";
  }
  if (filename.startsWith("planner-response")) {
    return "Planner response";
  }
  if (filename === "render-command.txt") {
    return "Render command";
  }
  return filename;
}

function payloadText(payload: TraceEvent["payload"]) {
  if (!payload) {
    return "";
  }
  return JSON.stringify(payload, null, 2);
}

export function JobTracePanel({ job }: JobTracePanelProps) {
  const [trace, setTrace] = useState<JobTraceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function loadTrace() {
    if (trace || loading) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setTrace(await api.getJobTrace(job.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load trace.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      void loadTrace();
    }
  }

  return (
    <>
      <div className="rounded-[22px] border border-border/70 bg-card/65 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="panel-label">Trace</p>
            <p className="mt-2 text-sm font-medium text-foreground">Planner and render activity</p>
          </div>
          <Badge variant="muted">{trace?.events.length ?? (job.result?.trace_file_id ? "saved" : job.status)}</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Open the structured execution log without letting debug output stretch the workspace.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => handleOpenChange(true)}>
          <Activity className="mr-2 size-4" />
          Open trace
        </Button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[min(94vw,960px)] flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <DialogTitle>Activity trace</DialogTitle>
            <DialogDescription>
              Review planner calls, render commands, and structured events for {titleizeSlug(job.preset_id)}.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading trace
                </div>
              ) : null}

              {error ? (
                <div className="flex items-start gap-2 rounded-[18px] bg-rose-500/12 p-3 text-sm leading-6 text-rose-700 dark:text-rose-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              ) : null}

              {trace && trace.events.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">No structured trace events have been written yet.</p>
              ) : null}

              {trace?.events.map((event, index) => {
                const payload = payloadText(event.payload);
                return (
                  <details key={`${event.timestamp}-${index}`} className="rounded-[18px] bg-card/75 p-3">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(event.severity)}>{event.severity}</Badge>
                        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {titleizeSlug(event.stage)} · {event.event}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-foreground">{event.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(event.timestamp)}</p>
                    </summary>
                    {payload ? (
                      <pre className="code-surface mt-3 max-h-80 overflow-auto rounded-[14px] p-3 text-xs leading-5">{payload}</pre>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">No structured payload for this event.</p>
                    )}
                  </details>
                );
              })}

              {trace && Object.keys(trace.artifacts).length > 0 ? (
                <div className="space-y-2 pt-1">
                  <p className="panel-label">Captured artifacts</p>
                  {Object.entries(trace.artifacts).map(([filename, content]) => (
                    <details key={filename} className="rounded-[18px] bg-card/75 p-3">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
                        <FileText className="size-4 text-muted-foreground" />
                        {artifactLabel(filename)}
                      </summary>
                      <pre className="code-surface mt-3 max-h-96 overflow-auto rounded-[14px] p-3 text-xs leading-5">
                        {content}
                      </pre>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
