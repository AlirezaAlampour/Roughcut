import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  compact = false
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        compact
          ? "panel-gradient animate-fade-up rounded-[28px] border border-border/60 px-5 py-5 shadow-soft lg:px-6 lg:py-5"
          : "panel-gradient animate-fade-up rounded-[34px] border border-border/60 px-6 py-7 shadow-soft lg:px-8 lg:py-8",
        className
      )}
    >
      <div className={cn("flex flex-col lg:flex-row lg:items-end lg:justify-between", compact ? "gap-4" : "gap-6")}>
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1
            className={cn(
              "mt-3 font-serif tracking-tight text-foreground",
              compact ? "text-[2rem] leading-tight lg:text-[2.3rem]" : "text-4xl lg:text-[3.2rem]"
            )}
          >
            {title}
          </h1>
          <p className={cn("max-w-2xl text-muted-foreground", compact ? "mt-2 text-sm leading-6" : "mt-4 text-base leading-7")}>
            {description}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
