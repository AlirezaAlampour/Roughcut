import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-fade-up rounded-[34px] border border-border/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(242,238,229,0.92))] px-6 py-7 shadow-soft lg:px-8 lg:py-8",
        className
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1 className="mt-3 font-serif text-4xl tracking-tight text-foreground lg:text-[3.2rem]">{title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

