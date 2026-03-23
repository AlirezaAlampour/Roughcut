"use client";

import Link from "next/link";
import { Clock3, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";

interface ProjectCardProps {
  project: ProjectSummary;
  onRename: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}

export function ProjectCard({ project, onRename, onDelete }: ProjectCardProps) {
  return (
    <Card className="group overflow-hidden transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(53,42,28,0.12)]">
      <Link href={`/projects/${project.id}`} className="block">
        <CardHeader className="gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="panel-label">Project</p>
              <CardTitle className="mt-2 text-2xl font-medium tracking-tight">{project.name}</CardTitle>
            </div>
            <StatusBadge status={project.status_summary.last_job_status} />
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="size-4" />
            Updated {formatDateTime(project.updated_at)}
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[22px] bg-muted/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Uploads</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{project.status_summary.upload_count}</p>
            </div>
            <div className="rounded-[22px] bg-muted/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Outputs</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{project.status_summary.output_count}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{project.status_summary.running_jobs} running</span>
            <span>{project.status_summary.queued_jobs} queued</span>
          </div>
        </CardContent>
      </Link>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 px-6 py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.preventDefault();
            onRename(project);
          }}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.preventDefault();
            onDelete(project);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

