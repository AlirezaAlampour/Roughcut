"use client";

import { useMemo, useRef, useState } from "react";
import { CloudUpload, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  disabled?: boolean;
  uploadProgress: number | null;
  uploadPhase?: "uploading" | "processing" | null;
  onFilesSelected: (files: File[]) => void;
  compact?: boolean;
}

export function UploadDropzone({
  disabled = false,
  uploadProgress,
  uploadPhase = null,
  onFilesSelected,
  compact = false
}: UploadDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const helperText = useMemo(() => {
    if (uploadPhase === "processing") {
      return "Saving upload and refreshing the project library.";
    }
    if (uploadProgress !== null) {
      return `Uploading ${uploadProgress}%`;
    }
    if (compact) {
      return "Drag and drop your files here, or click to browse.";
    }
    return "Drag and drop your files here, or click to browse for a long-form video or audio source.";
  }, [compact, uploadPhase, uploadProgress]);

  function emitFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || disabled) {
      return;
    }
    onFilesSelected(Array.from(fileList));
  }

  function resetDragState() {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }

  return (
    <Card
      className={cn(
        "cursor-pointer border-2 border-dashed transition-colors duration-200 ease-in-out",
        isDragActive
          ? "border-[3px] border-primary bg-primary/5"
          : "border-border/50 bg-zinc-50/50 dark:bg-zinc-900/50",
        disabled && "cursor-not-allowed opacity-70"
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) {
          inputRef.current?.click();
        }
      }}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragActive(true);
      }}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setIsDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        resetDragState();
        emitFiles(event.dataTransfer.files);
      }}
    >
      <CardContent className={cn("flex flex-col items-center text-center", compact ? "gap-3 px-4 py-4" : "gap-4 px-6 py-8")}>
        <div
          className={cn(
            "flex items-center justify-center rounded-3xl bg-primary/10 text-primary transition-colors duration-200 ease-in-out",
            isDragActive && "bg-primary/15",
            compact ? "size-11" : "size-14"
          )}
        >
          <CloudUpload className={cn(compact ? "size-5" : "size-6")} />
        </div>
        <div className={cn(compact ? "space-y-1" : "space-y-2")}>
          <h3 className={cn("font-medium tracking-tight text-foreground", compact ? "text-base" : "text-lg")}>
            Upload source media
          </h3>
          <p className={cn("text-muted-foreground", compact ? "max-w-sm text-xs leading-5" : "max-w-md text-sm leading-6")}>
            {helperText}
          </p>
        </div>
        {uploadPhase === "processing" ? (
          <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", compact ? "" : "max-w-sm")}>
            <Loader2 className="size-4 animate-spin" />
            <span>Finalizing upload</span>
          </div>
        ) : uploadProgress !== null ? (
          <Progress value={uploadProgress} className={cn("w-full", compact ? "" : "max-w-sm")} />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size={compact ? "sm" : "default"}
          className="h-10"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <Plus className="mr-2 size-4" />
          Choose files
        </Button>
        <input
          ref={inputRef}
          hidden
          multiple
          accept="video/*,audio/*"
          type="file"
          onChange={(event) => {
            resetDragState();
            emitFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </CardContent>
    </Card>
  );
}
