"use client";

import type { ReactNode } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  listClassName
}: FileListProps) {
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
        {files.length === 0 ? (
          <div className="panel-inset min-h-[140px] rounded-[22px] px-4 py-6 text-sm leading-6 text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className={cn("pr-1", listClassName)}>
            {files.map((file, index) => (
              <div key={file.id}>
                <div
                  className={cn(
                    "flex cursor-pointer items-start justify-between gap-3 rounded-[22px] border border-transparent px-3.5 py-3.5 transition",
                    selectedFileId === file.id ? "border-primary/20 bg-primary/8" : "hover:bg-muted/80"
                  )}
                  onClick={() => onSelect(file)}
                >
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
                {index < files.length - 1 ? <Separator className="my-2" /> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
