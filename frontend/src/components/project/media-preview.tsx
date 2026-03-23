import { FileText, Film, Music4 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDuration } from "@/lib/format";
import type { FileItem } from "@/lib/types";

export function MediaPreview({ file }: { file?: FileItem | null }) {
  if (!file) {
    return (
      <Card className="h-full">
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
            <Film className="size-7" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Nothing selected</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Choose an uploaded source or generated output to preview it here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isVideo = file.mime_type?.startsWith("video/");
  const isAudio = file.mime_type?.startsWith("audio/");

  return (
    <Card className="h-full">
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="panel-label">{file.kind === "upload" ? "Source Media" : "Generated Output"}</p>
            <CardTitle className="mt-2 text-2xl font-medium tracking-tight">{file.name}</CardTitle>
          </div>
          <Badge variant="muted">{file.role.replace(/_/g, " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-hidden rounded-[28px] border border-border/70 bg-[#f5f1ea]">
          {isVideo ? (
            <video key={file.id} controls className="aspect-video w-full bg-black" src={file.preview_url || file.download_url} />
          ) : isAudio ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-5 px-8 py-10">
              <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
                <Music4 className="size-7" />
              </div>
              <audio key={file.id} controls className="w-full max-w-lg" src={file.preview_url || file.download_url} />
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 px-8 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
                <FileText className="size-7" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground">Preview not available</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  This artifact is stored and downloadable, but this surface only previews playable media in v1.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] bg-muted/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Type</p>
            <p className="mt-2 text-sm font-medium text-foreground">{file.media_type}</p>
          </div>
          <div className="rounded-[24px] bg-muted/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Size</p>
            <p className="mt-2 text-sm font-medium text-foreground">{formatBytes(file.size_bytes)}</p>
          </div>
          <div className="rounded-[24px] bg-muted/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Duration</p>
            <p className="mt-2 text-sm font-medium text-foreground">{formatDuration(file.duration_seconds)}</p>
          </div>
          <div className="rounded-[24px] bg-muted/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Resolution</p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {file.width && file.height ? `${file.width} × ${file.height}` : "N/A"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

