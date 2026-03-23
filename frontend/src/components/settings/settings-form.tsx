"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import type { PresetConfig, SettingsResponse, SettingsUpdateRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function SettingsForm({
  initialSettings,
  presets,
  onSaved
}: {
  initialSettings: SettingsResponse;
  presets: PresetConfig[];
  onSaved: (settings: SettingsResponse) => void;
}) {
  const [values, setValues] = useState(initialSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(initialSettings);
  }, [initialSettings]);

  function update<K extends keyof SettingsResponse>(key: K, value: SettingsResponse[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      const payload: SettingsUpdateRequest = {
        llm_base_url: values.llm_base_url,
        llm_model: values.llm_model,
        default_preset: values.default_preset,
        cut_aggressiveness: values.cut_aggressiveness,
        captions_enabled: values.captions_enabled,
        output_quality_preset: values.output_quality_preset
      };
      const updated = await api.updateSettings(payload);
      setValues(updated);
      onSaved(updated);
      toast.success("Settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Settings</CardTitle>
        <CardDescription>
          Keep this short. The only things that really matter in v1 are where the planner lives and how aggressively the pipeline should cut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="llm-base-url">Local LLM base URL</Label>
            <Input
              id="llm-base-url"
              value={values.llm_base_url}
              onChange={(event) => update("llm_base_url", event.target.value)}
              placeholder="http://host.docker.internal:8001/v1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="llm-model">Planner model</Label>
            <Input
              id="llm-model"
              value={values.llm_model}
              onChange={(event) => update("llm_model", event.target.value)}
              placeholder="qwen2.5-14b-instruct"
            />
          </div>
          <div className="space-y-2">
            <Label>Default preset</Label>
            <Select value={values.default_preset} onValueChange={(value) => update("default_preset", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default cut aggressiveness</Label>
            <Select
              value={values.cut_aggressiveness}
              onValueChange={(value) => update("cut_aggressiveness", value as SettingsResponse["cut_aggressiveness"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose pacing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Output quality</Label>
            <Select
              value={values.output_quality_preset}
              onValueChange={(value) => update("output_quality_preset", value as SettingsResponse["output_quality_preset"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="quality">Quality</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-[26px] border border-border/70 bg-muted/60 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Captions on by default</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  This toggles burned-in captions for new jobs. Transcript and SRT exports remain available.
                </p>
              </div>
              <Switch checked={values.captions_enabled} onCheckedChange={(checked) => update("captions_enabled", checked)} />
            </div>
          </div>
        </div>

        <details className="rounded-[26px] border border-border/70 bg-muted/45 p-5">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced</summary>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Project storage root</Label>
              <Input value={values.project_storage_root} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Transcription model</Label>
              <Input value={values.transcription_model} readOnly />
            </div>
          </div>
        </details>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 size-4" />
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
