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
}

export function UploadDropzone({ disabled = false, uploadProgress, onFilesSelected }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const helperText = useMemo(() => {
    if (uploadProgress !== null) {
      return `Uploading ${uploadProgress}%`;
    }
    return "Drop raw video or audio here, or choose files from your computer.";
  }, [uploadProgress]);

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
        dragging ? "border-primary/50 bg-accent/30" : "border-border/80 bg-white/80",
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
      <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <CloudUpload className="size-6" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-medium tracking-tight text-foreground">Upload source media</h3>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">{helperText}</p>
        </div>
        {uploadProgress !== null ? <Progress value={uploadProgress} className="max-w-sm" /> : null}
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
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

