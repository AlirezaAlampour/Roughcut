"use client";

import { useMemo, useRef, useState } from "react";
import { CloudUpload, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  disabled?: boolean;
  uploadProgress: number | null;
  onFilesSelected: (files: File[]) => void;
  compact?: boolean;
}

export function UploadDropzone({ disabled = false, uploadProgress, onFilesSelected, compact = false }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const helperText = useMemo(() => {
    if (uploadProgress !== null) {
      return `Uploading ${uploadProgress}%`;
    }
    if (compact) {
      return "Drop a source here or pick files from your computer.";
    }
    return "Drop one long-form video or audio source here, or choose a file from your computer.";
  }, [compact, uploadProgress]);

  function emitFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || disabled) {
      return;
    }
    onFilesSelected(Array.from(fileList));
  }

  return (
    <Card
      className={cn(
        "border-dashed transition",
        dragging ? "border-primary/50 bg-accent/30" : "border-border/80 bg-card/85",
        disabled && "opacity-70"
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        emitFiles(event.dataTransfer.files);
      }}
    >
      <CardContent className={cn("flex flex-col items-center text-center", compact ? "gap-3 px-4 py-4" : "gap-4 px-6 py-8")}>
        <div className={cn("flex items-center justify-center rounded-3xl bg-primary/10 text-primary", compact ? "size-11" : "size-14")}>
          <CloudUpload className={cn(compact ? "size-5" : "size-6")} />
        </div>
        <div className={cn(compact ? "space-y-1" : "space-y-2")}>
          <h3 className={cn("font-medium tracking-tight text-foreground", compact ? "text-base" : "text-lg")}>
            Upload long-form source
          </h3>
          <p className={cn("text-muted-foreground", compact ? "max-w-sm text-xs leading-5" : "max-w-md text-sm leading-6")}>
            {helperText}
          </p>
        </div>
        {uploadProgress !== null ? <Progress value={uploadProgress} className={cn("w-full", compact ? "" : "max-w-sm")} /> : null}
        <Button
          type="button"
          variant="secondary"
          size={compact ? "sm" : "default"}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
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
          onChange={(event) => emitFiles(event.target.files)}
        />
      </CardContent>
    </Card>
  );
}
