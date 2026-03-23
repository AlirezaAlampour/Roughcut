import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
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
  description: "Local-first AI-assisted YouTube rough-cut editing."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
        <Toaster
          richColors
          closeButton
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: "20px",
              border: "1px solid rgba(213, 203, 190, 0.85)",
              background: "rgba(255,255,255,0.96)",
              color: "rgb(59, 46, 31)"
            }
          }}
        />
      </body>
    </html>
  );
}
