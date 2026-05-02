"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FolderKanban, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: Settings2 }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 pb-4 pt-4 lg:h-full lg:min-h-0 lg:flex-row lg:gap-4 lg:px-5 lg:py-5">
        <aside className="app-frame flex shrink-0 flex-col rounded-[28px] border border-border/60 px-4 py-4 shadow-soft backdrop-blur lg:h-full lg:w-[80px] lg:items-center lg:px-2.5 lg:py-3.5">
          <div className="flex items-center gap-2.5 lg:flex-col lg:gap-0">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift lg:size-10">
              <Clapperboard className="size-[18px]" />
            </div>
            <div className="lg:mt-2 lg:text-center">
              <p className="font-serif text-[1.55rem] tracking-tight lg:hidden">Roughcut</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground lg:hidden">Local shorts</p>
              <p className="hidden text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground lg:block">RC</p>
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:items-center lg:gap-2.5 lg:overflow-visible">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "flex min-w-fit items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-sm transition lg:size-10 lg:min-w-0 lg:justify-center lg:gap-0 lg:px-0",
                    active
                      ? "bg-primary text-primary-foreground shadow-lift"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  <span className="lg:sr-only">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3 lg:w-full lg:justify-center lg:pt-2.5">
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground lg:hidden">Theme</span>
            <ThemeToggle compact />
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
