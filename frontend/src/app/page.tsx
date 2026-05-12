"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
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

type ProjectCreationMode = "factory" | "quick-caption";

const QUICK_CAPTION_PROJECT_PREFIX = "[Caption]";

function isQuickCaptionProjectName(name: string) {
  return name.includes(QUICK_CAPTION_PROJECT_PREFIX);
}

function projectNameForMode(name: string, mode: ProjectCreationMode) {
  const trimmedName = name.trim();
  if (mode !== "quick-caption") {
    return trimmedName;
  }
  return isQuickCaptionProjectName(trimmedName)
    ? trimmedName
    : `${QUICK_CAPTION_PROJECT_PREFIX} ${trimmedName}`;
}

function projectNameForInput(name: string) {
  return isQuickCaptionProjectName(name) ? name.replace(QUICK_CAPTION_PROJECT_PREFIX, "").trimStart() : name;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ProjectCreationMode>("factory");
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
        setCreateMode("factory");
        setCreateOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openCreateDialog(mode: ProjectCreationMode) {
    setCreateMode(mode);
    setCreateOpen(true);
  }

  async function handleCreate(name: string) {
    try {
      setBusy(true);
      const created = await api.createProject(projectNameForMode(name, createMode));
      setProjects((current) => [created, ...current]);
      setCreateOpen(false);
      toast.success(createMode === "quick-caption" ? "Quick caption project created." : "Shorts factory project created.");
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
      const updated = await api.renameProject(
        renameTarget.id,
        projectNameForMode(name, isQuickCaptionProjectName(renameTarget.name) ? "quick-caption" : "factory")
      );
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
    <div className="space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:space-y-7">
      <PageHeader
        eyebrow="Projects"
        title="Choose the workflow before you start."
        description="Use Shorts Factory for AI-ranked clips from long videos, or Quick Caption for pre-cut shorts that just need transcription and styling."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="secondary" onClick={() => openCreateDialog("factory")}>
              <Plus className="mr-2 size-4" />
              New Shorts Factory Project
            </Button>
            <Button size="lg" onClick={() => openCreateDialog("quick-caption")}>
              <Sparkles className="mr-2 size-4" />
              New Quick Caption Project
            </Button>
          </div>
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
                Start a Shorts Factory project when you want ranked clips from a long source, or start a Quick Caption project when you already have the short and just need transcript cleanup plus caption styling.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" variant="secondary" onClick={() => openCreateDialog("factory")}>
                <Plus className="mr-2 size-4" />
                New Shorts Factory Project
              </Button>
              <Button size="lg" onClick={() => openCreateDialog("quick-caption")}>
                <Sparkles className="mr-2 size-4" />
                New Quick Caption Project
              </Button>
            </div>
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
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateMode("factory");
          }
        }}
        title={createMode === "quick-caption" ? "Create Quick Caption project" : "Create Shorts Factory project"}
        description={
          createMode === "quick-caption"
            ? "Quick Caption projects skip AI clip planning so you can upload a pre-cut short and jump straight into captions."
            : "Shorts Factory projects keep long-form uploads, ranked candidates, and exports together."
        }
        label="Project name"
        submitLabel={createMode === "quick-caption" ? "Create quick caption project" : "Create shorts factory project"}
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
        initialValue={renameTarget ? projectNameForInput(renameTarget.name) : undefined}
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
