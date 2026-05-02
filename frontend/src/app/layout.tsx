import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import "@/app/globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans"
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif"
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_TITLE || "Roughcut",
  description: "Local-first AI-assisted shorts candidate generation."
};

const themeScript = `
  (() => {
    try {
      const root = document.documentElement;
      const saved = window.localStorage.getItem("roughcut-theme");
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = saved === "light" || saved === "dark" ? saved : systemDark ? "dark" : "light";
      root.classList.toggle("dark", theme === "dark");
      root.style.colorScheme = theme;
    } catch (_error) {
      // Ignore theme hydration issues and fall back to CSS defaults.
    }
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
        <Script id="roughcut-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <AppShell>{children}</AppShell>
        <Toaster
          richColors
          closeButton
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: "20px",
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card) / 0.96)",
              color: "hsl(var(--foreground))"
            }
          }}
        />
      </body>
    </html>
  );
}
