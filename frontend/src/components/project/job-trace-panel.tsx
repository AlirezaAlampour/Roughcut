"use client";

import { useState } from "react";
import { Activity, AlertTriangle, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatDateTime, titleizeSlug } from "@/lib/format";
import type { JobSummary, JobTraceResponse, TraceEvent } from "@/lib/types";

interface JobTracePanelProps {
  job: JobSummary;
}

function severityVariant(severity: TraceEvent["severity"]) {
  return severity === "error" || severity === "warning" ? "default" : "muted";
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

  return (
    <details
      className="mt-4 rounded-[22px] border border-border/70 bg-muted/45 p-4"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          void loadTrace();
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <Activity className="size-4 shrink-0 text-muted-foreground" />
          <span>Activity trace</span>
        </span>
        <Badge variant="muted">{trace?.events.length ?? (job.result?.trace_file_id ? "saved" : job.status)}</Badge>
      </summary>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading trace
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-[18px] bg-rose-50 p-3 text-sm leading-6 text-rose-700">
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
            <details key={`${event.timestamp}-${index}`} className="rounded-[18px] bg-white/75 p-3">
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
                <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-[#181818] p-3 text-xs leading-5 text-white">
                  {payload}
                </pre>
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
              <details key={filename} className="rounded-[18px] bg-white/75 p-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
                  <FileText className="size-4 text-muted-foreground" />
                  {artifactLabel(filename)}
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto rounded-[14px] bg-[#181818] p-3 text-xs leading-5 text-white">
                  {content}
                </pre>
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
