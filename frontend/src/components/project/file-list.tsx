"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { formatBytes, formatDuration } from "@/lib/format";
import type { FileItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FileListProps {
  title: string;
  description: string;
  files: FileItem[];
  selectedFileId?: string | null;
  emptyMessage: string;
  onSelect: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  actions?: ReactNode;
  lead?: ReactNode;
  className?: string;
  contentClassName?: string;
  listClassName?: string;
  enableBulkActions?: boolean;
  onDeleteSelected?: (files: FileItem[]) => Promise<void> | void;
  onRenderSelected?: (files: FileItem[]) => Promise<void> | void;
  onBatchProcessSelected?: (files: FileItem[]) => Promise<void> | void;
}

function triggerDownloads(files: FileItem[]) {
  for (const file of files) {
    const link = document.createElement("a");
    link.href = file.download_url;
    link.download = file.name;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

export function FileList({
  title,
  description,
  files,
  selectedFileId,
  emptyMessage,
  onSelect,
  onRename,
  onDelete,
  actions,
  lead,
  className,
  contentClassName,
  listClassName,
  enableBulkActions = false,
  onDeleteSelected,
  onRenderSelected,
  onBatchProcessSelected
}: FileListProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkRendering, setBulkRendering] = useState(false);
  const [bulkBatchProcessing, setBulkBatchProcessing] = useState(false);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => files.some((file) => file.id === id)));
  }, [files]);

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedIds.includes(file.id)),
    [files, selectedIds]
  );
  const allSelected = files.length > 0 && selectedIds.length === files.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  function toggleSelected(fileId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? Array.from(new Set([...current, fileId])) : current.filter((id) => id !== fileId)
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? files.map((file) => file.id) : []);
  }

  async function handleDeleteSelected() {
    if (!onDeleteSelected || selectedFiles.length === 0) {
      return;
    }
    try {
      setBulkDeleting(true);
      await onDeleteSelected(selectedFiles);
      setSelectedIds([]);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleRenderSelected() {
    if (!onRenderSelected || selectedFiles.length === 0) {
      return;
    }
    try {
      setBulkRendering(true);
      await onRenderSelected(selectedFiles);
    } finally {
      setBulkRendering(false);
    }
  }

  async function handleBatchProcessSelected() {
    if (!onBatchProcessSelected || selectedFiles.length === 0) {
      return;
    }
    try {
      setBulkBatchProcessing(true);
      await onBatchProcessSelected(selectedFiles);
    } finally {
      setSelectedIds([]);
      setBulkBatchProcessing(false);
    }
  }

  const listContent =
    files.length === 0 ? (
      <div className="panel-inset min-h-[140px] rounded-[22px] px-4 py-6 text-sm leading-6 text-muted-foreground">
        {emptyMessage}
      </div>
    ) : (
      files.map((file, index) => (
        <div key={file.id}>
          <div
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-[22px] border border-transparent px-3.5 py-3.5 transition",
              selectedFileId === file.id ? "border-primary/20 bg-primary/8" : "hover:bg-muted/80"
            )}
            onClick={() => onSelect(file)}
          >
            {enableBulkActions ? (
              <div
                className="flex shrink-0 pt-0.5"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  aria-label={`Select ${file.name}`}
                  checked={selectedIds.includes(file.id)}
                  onCheckedChange={(checked) => toggleSelected(file.id, checked)}
                />
              </div>
            ) : null}

            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {formatBytes(file.size_bytes)} · {file.media_type}
                  {file.duration_seconds ? ` · ${formatDuration(file.duration_seconds)}` : ""}
                </p>
                {file.width && file.height ? (
                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {file.width} × {file.height}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRename(file);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                  <a
                    href={file.download_url}
                    download
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Download ${file.name}`}
                  >
                    <Download className="size-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(file);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          {index < files.length - 1 ? <Separator className="my-2" /> : null}
        </div>
      ))
    );

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn("flex min-h-0 flex-1 flex-col gap-3", contentClassName)}>
        {lead ? <div className="shrink-0">{lead}</div> : null}
        {enableBulkActions && files.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-border/70 bg-background/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <Checkbox
                aria-label="Select all files"
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm font-medium text-foreground">Select All</span>
              {selectedFiles.length > 0 ? (
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {selectedFiles.length} selected
                </span>
              ) : null}
            </div>

            {selectedFiles.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {onBatchProcessSelected ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={bulkDeleting || bulkRendering || bulkBatchProcessing}
                    onClick={() => void handleBatchProcessSelected()}
                  >
                    {bulkBatchProcessing ? "Starting..." : "Batch Process Selected"}
                  </Button>
                ) : null}
                {onRenderSelected ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={bulkDeleting || bulkRendering || bulkBatchProcessing}
                    onClick={() => void handleRenderSelected()}
                    variant={onBatchProcessSelected ? "secondary" : "default"}
                  >
                    {bulkRendering ? "Starting..." : "Render Selected"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={bulkDeleting || bulkRendering || bulkBatchProcessing}
                  onClick={() => triggerDownloads(selectedFiles)}
                >
                  Download Selected
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={bulkDeleting || bulkRendering || bulkBatchProcessing}
                  onClick={() => void handleDeleteSelected()}
                >
                  {bulkDeleting ? "Deleting..." : "Delete Selected"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={cn("max-h-[400px] overflow-y-auto pr-2 space-y-3 custom-scrollbar", listClassName)}>
          {listContent}
        </div>
      </CardContent>
    </Card>
  );
}
