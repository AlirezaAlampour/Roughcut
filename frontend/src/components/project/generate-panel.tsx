"use client";

import { useEffect, useState } from "react";
import { WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Aggressiveness, FileItem, JobCreateRequest, PresetConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GeneratePanelProps {
  uploads: FileItem[];
  presets: PresetConfig[];
  defaultPreset?: string;
  defaultAggressiveness?: Aggressiveness;
  defaultCaptions?: boolean;
  busy?: boolean;
  onSubmit: (payload: JobCreateRequest) => Promise<void> | void;
  className?: string;
}

export function GeneratePanel({
  uploads,
  presets,
  defaultPreset,
  defaultAggressiveness = "balanced",
  defaultCaptions = true,
  busy = false,
  onSubmit,
  className
}: GeneratePanelProps) {
  const [sourceFileId, setSourceFileId] = useState("");
  const [presetId, setPresetId] = useState(defaultPreset || "");
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>(defaultAggressiveness);
  const [captionsEnabled, setCaptionsEnabled] = useState(defaultCaptions);
  const [userNotes, setUserNotes] = useState("");

  useEffect(() => {
    if (!sourceFileId && uploads[0]) {
      setSourceFileId(uploads[0].id);
    }
  }, [sourceFileId, uploads]);

  useEffect(() => {
    if (!presetId && presets[0]) {
      setPresetId(defaultPreset || presets[0].id);
    }
  }, [defaultPreset, presetId, presets]);

  const activePreset = presets.find((preset) => preset.id === presetId);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Generate shorts candidates</CardTitle>
        <CardDescription>
          Pick a source, choose a shorts preset, and let the local planner rank compact candidate clips.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Source media</Label>
          <Select value={sourceFileId} onValueChange={setSourceFileId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a source file" />
            </SelectTrigger>
            <SelectContent>
              {uploads.map((file) => (
                <SelectItem key={file.id} value={file.id}>
                  {file.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Preset</Label>
          <Select value={presetId} onValueChange={setPresetId}>
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
          {activePreset ? (
            <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
              {activePreset.description} Targets {activePreset.target_clip_min_sec}-{activePreset.target_clip_max_sec}s.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Candidate density</Label>
          <Select value={aggressiveness} onValueChange={(value) => setAggressiveness(value as Aggressiveness)}>
            <SelectTrigger>
              <SelectValue placeholder="Select density" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conservative">Fewer, longer</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="aggressive">More, tighter</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <details className="rounded-[22px] border border-border/70 bg-card/70 p-3.5">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Output options</summary>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-[18px] bg-muted/80 px-3.5 py-3">
            <div>
              <Label>Burn captions into output</Label>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Candidate exports still include SRT and VTT when available.
              </p>
            </div>
            <Switch checked={captionsEnabled} onCheckedChange={setCaptionsEnabled} />
          </div>
        </details>

        <details className="rounded-[22px] border border-border/70 bg-card/70 p-3.5" open={Boolean(userNotes)}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">Planner notes (optional)</summary>
          <div className="mt-3">
            <Textarea
              className="min-h-[96px]"
              placeholder="Examples: favor local AI lessons, avoid salesy CTAs, prefer blunt technical takes."
              value={userNotes}
              onChange={(event) => setUserNotes(event.target.value)}
            />
          </div>
        </details>

        <Button
          size="lg"
          className="w-full"
          disabled={busy || !sourceFileId || !presetId || uploads.length === 0}
          onClick={() =>
            onSubmit({
              source_file_id: sourceFileId,
              preset_id: presetId,
              aggressiveness,
              captions_enabled: captionsEnabled,
              generate_shorts: true,
              user_notes: userNotes.trim() || undefined
            })
          }
        >
          <WandSparkles className="mr-2 size-4" />
          {busy ? "Generating..." : "Generate Shorts Candidates"}
        </Button>
      </CardContent>
    </Card>
  );
}
