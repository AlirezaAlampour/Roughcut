import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-2xl bg-[linear-gradient(110deg,hsl(var(--muted))_25%,hsl(var(--card))_50%,hsl(var(--muted))_75%)] bg-[length:200%_100%]",
        className
      )}
    />
  );
}
