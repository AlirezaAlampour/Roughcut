"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FolderKanban, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: Settings2 }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 pb-6 pt-4 lg:flex-row lg:gap-6 lg:px-6 lg:py-6">
        <aside className="mb-4 rounded-[32px] border border-border/60 bg-white/80 p-4 shadow-soft backdrop-blur lg:sticky lg:top-6 lg:mb-0 lg:h-[calc(100vh-3rem)] lg:w-[280px] lg:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift">
              <Clapperboard className="size-5" />
            </div>
            <div>
              <p className="font-serif text-2xl tracking-tight">Roughcut</p>
              <p className="text-sm text-muted-foreground">Local-first shorts factory</p>
            </div>
          </div>

          <nav className="mt-8 flex gap-2 overflow-x-auto lg:flex-col">
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

          <div className="mt-8 rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(245,241,234,0.92),rgba(255,255,255,0.98))] p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Local Run</p>
            <p className="mt-2 text-sm leading-6 text-foreground">
              Upload long-form media, generate ranked shorts candidates, and keep the whole pipeline on your own network.
            </p>
          </div>
        </aside>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
