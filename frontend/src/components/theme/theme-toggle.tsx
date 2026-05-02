"use client";

import { MonitorCog, MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "roughcut-theme";

type ResolvedTheme = "light" | "dark";
type ThemeSource = ResolvedTheme | "system";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [themeSource, setThemeSource] = useState<ThemeSource>("system");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    const initialSource = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";
    const initialTheme = initialSource === "system" ? getSystemTheme() : initialSource;

    setThemeSource(initialSource);
    setResolvedTheme(initialTheme);
    applyTheme(initialTheme);
    setMounted(true);

    const onMediaChange = () => {
      if (window.localStorage.getItem(STORAGE_KEY)) {
        return;
      }
      const nextTheme = getSystemTheme();
      setThemeSource("system");
      setResolvedTheme(nextTheme);
      applyTheme(nextTheme);
    };

    mediaQuery.addEventListener("change", onMediaChange);
    return () => mediaQuery.removeEventListener("change", onMediaChange);
  }, []);

  function toggleTheme() {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setThemeSource(nextTheme);
    setResolvedTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("h-auto w-full justify-start rounded-[24px] px-4 py-3", className)}
      onClick={toggleTheme}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {mounted ? (
              resolvedTheme === "dark" ? <MoonStar className="size-4" /> : <SunMedium className="size-4" />
            ) : (
              <MonitorCog className="size-4" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {mounted ? (resolvedTheme === "dark" ? "Dark mode" : "Light mode") : "Theme"}
            </p>
            <p className="text-xs text-muted-foreground">
              {mounted && themeSource !== "system"
                ? "Stored locally on this browser."
                : "Following system until you switch it."}
            </p>
          </div>
        </div>
        <span className="panel-label">{mounted ? (resolvedTheme === "dark" ? "Moon" : "Sun") : "Auto"}</span>
      </div>
    </Button>
  );
}
