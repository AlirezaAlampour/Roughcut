"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { PresetConfig, SettingsResponse } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [settingsResult, presetsResult] = await Promise.all([api.getSettings(), api.listPresets()]);
        setSettings(settingsResult);
        setPresets(presetsResult.items);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load settings.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Keep the setup small."
        description="Point the backend at your local planner, pick shorts-oriented defaults, and leave the rest alone until you actually need more control."
      />

      {loading ? (
        <Skeleton className="h-[520px] w-full rounded-[30px]" />
      ) : settings ? (
        <SettingsForm initialSettings={settings} presets={presets} onSaved={setSettings} />
      ) : (
        <Card>
          <CardContent className="px-6 py-10 text-sm leading-6 text-muted-foreground">
            Settings are not available right now.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
