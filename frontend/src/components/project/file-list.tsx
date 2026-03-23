"use client";

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
}

export function FileList({
  title,
  description,
  files,
  selectedFileId,
  emptyMessage,
  onSelect,
  onRename,
  onDelete
}: FileListProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.length === 0 ? (
          <div className="rounded-[22px] bg-muted/75 px-4 py-6 text-sm leading-6 text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          files.map((file, index) => (
            <div key={file.id}>
              <div
                className={cn(
                  "flex cursor-pointer items-start justify-between gap-4 rounded-[24px] px-4 py-4 transition",
                  selectedFileId === file.id ? "bg-primary/8" : "hover:bg-muted/80"
                )}
                onClick={() => onSelect(file)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatBytes(file.size_bytes)} · {file.media_type}
                    {file.duration_seconds ? ` · ${formatDuration(file.duration_seconds)}` : ""}
                  </p>
                  {file.width && file.height ? (
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {file.width} × {file.height}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRename(file);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
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
          ))
        )}
      </CardContent>
    </Card>
  );
}

