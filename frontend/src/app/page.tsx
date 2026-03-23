"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NameDialog } from "@/components/ui/name-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectCard } from "@/components/projects/project-card";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  async function loadProjects() {
    try {
      setLoading(true);
      const result = await api.listProjects();
      setProjects(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
          return;
        }
        event.preventDefault();
        setCreateOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleCreate(name: string) {
    try {
      setBusy(true);
      const created = await api.createProject(name);
      setProjects((current) => [created, ...current]);
      setCreateOpen(false);
      toast.success("Project created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(name: string) {
    if (!renameTarget) {
      return;
    }

    try {
      setBusy(true);
      const updated = await api.renameProject(renameTarget.id, name);
      setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)));
      setRenameTarget(null);
      toast.success("Project renamed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setBusy(true);
      await api.deleteProject(deleteTarget.id);
      setProjects((current) => current.filter((project) => project.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("Project deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 lg:space-y-7">
      <PageHeader
        eyebrow="Projects"
        title="Rough cuts without the boring labor."
        description="Create a project, upload raw media, let the local planner shape an edit plan, and get back a downloadable first pass you can actually use."
        actions={
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            New project
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-4 px-6 py-6">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[360px] flex-col items-center justify-center gap-5 text-center">
            <div className="max-w-xl">
              <p className="panel-label">Empty State</p>
              <h2 className="mt-3 font-serif text-3xl tracking-tight text-foreground">Start with one clean project.</h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                This app stays calm on purpose. Create a project, press <span className="rounded bg-muted px-2 py-1 text-xs">N</span> any time to make another, and keep everything organized around simple upload-to-output flows.
              </p>
            </div>
            <Button size="lg" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              Create project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create project"
        description="Projects keep uploads, outputs, and job history together."
        label="Project name"
        submitLabel="Create project"
        pending={busy}
        onSubmit={handleCreate}
      />

      <NameDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
        title="Rename project"
        description="Use a clear, human-readable project name. Files stay untouched."
        label="Project name"
        initialValue={renameTarget?.name}
        submitLabel="Save name"
        pending={busy}
        onSubmit={handleRename}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project, its uploaded media, outputs, and job history from the DGX Spark.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

