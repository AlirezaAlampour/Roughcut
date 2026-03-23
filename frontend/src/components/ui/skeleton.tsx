import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-2xl bg-[linear-gradient(110deg,rgba(229,223,213,0.7),rgba(255,255,255,0.92),rgba(229,223,213,0.7))] bg-[length:200%_100%]",
        className
      )}
    />
  );
}

