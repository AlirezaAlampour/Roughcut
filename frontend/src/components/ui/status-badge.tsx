import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";
import { titleizeSlug } from "@/lib/format";

export function StatusBadge({ status }: { status: JobStatus | null | undefined }) {
  if (!status) {
    return <Badge variant="muted">Idle</Badge>;
  }

  const variant =
    status === "completed"
      ? "success"
      : status === "failed" || status === "canceled"
        ? "danger"
        : status === "running"
          ? "warning"
          : "default";

  return <Badge variant={variant}>{titleizeSlug(status)}</Badge>;
}

