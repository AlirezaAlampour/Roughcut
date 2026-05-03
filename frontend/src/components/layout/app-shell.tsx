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
      <div className="flex min-h-screen w-full min-w-0 items-stretch lg:h-full">
        <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-zinc-900 bg-zinc-950 px-2 py-4 text-zinc-100 shadow-soft">
          <Link
            href="/"
            aria-label="Roughcut home"
            title="Roughcut home"
            className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift transition hover:opacity-95"
          >
            <Clapperboard className="size-[18px]" />
            <span className="sr-only">Roughcut home</span>
          </Link>

          <nav className="mt-8 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto">
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
                    "flex size-11 items-center justify-center rounded-2xl text-sm transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-lift"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  )}
                >
                  <Icon className="size-4" />
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex w-full justify-center border-t border-zinc-900 pt-3">
            <ThemeToggle
              compact
              className="border-zinc-800 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800 hover:text-zinc-100"
            />
          </div>
        </aside>

        <main className="flex min-h-screen min-w-0 flex-1 flex-col overflow-hidden lg:h-full lg:min-h-0">
          <div className="flex min-h-screen min-w-0 flex-1 flex-col px-4 py-4 lg:min-h-0 lg:px-5 lg:py-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
