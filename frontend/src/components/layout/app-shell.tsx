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
      <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 pb-4 pt-4 lg:h-full lg:min-h-0 lg:flex-row lg:gap-5 lg:px-5 lg:py-5">
        <aside className="app-frame flex shrink-0 flex-col rounded-[32px] border border-border/60 p-4 shadow-soft backdrop-blur lg:h-full lg:w-[280px] lg:overflow-hidden lg:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift">
              <Clapperboard className="size-5" />
            </div>
            <div>
              <p className="font-serif text-2xl tracking-tight">Roughcut</p>
              <p className="text-sm text-muted-foreground">Local-first shorts factory</p>
            </div>
          </div>

          <nav className="mt-8 flex gap-2 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-w-fit items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-lift"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto space-y-3 pt-8">
            <ThemeToggle />
            <div className="panel-gradient rounded-[24px] border border-border/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Local Run</p>
              <p className="mt-2 text-sm leading-6 text-foreground">
                Upload long-form media, generate ranked shorts candidates, and keep the whole pipeline on your own network.
              </p>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
