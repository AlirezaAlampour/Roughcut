import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-[0.02em]",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        muted: "bg-muted text-muted-foreground",
        success: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/16 dark:text-emerald-200",
        warning: "bg-amber-500/14 text-amber-800 dark:bg-amber-400/18 dark:text-amber-100",
        danger: "bg-rose-500/12 text-rose-700 dark:bg-rose-400/16 dark:text-rose-100"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
