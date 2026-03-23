"use client";

import { useEffect, useState } from "react";
import { WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Aggressiveness, FileItem, JobCreateRequest, PresetConfig } from "@/lib/types";

interface GeneratePanelProps {
  uploads: FileItem[];
  presets: PresetConfig[];
  defaultPreset?: string;
  defaultAggressiveness?: Aggressiveness;
  defaultCaptions?: boolean;
  busy?: boolean;
  onSubmit: (payload: JobCreateRequest) => Promise<void> | void;
}

export function GeneratePanel({
  uploads,
  presets,
  defaultPreset,
  defaultAggressiveness = "balanced",
  defaultCaptions = true,
  busy = false,
  onSubmit
}: GeneratePanelProps) {
  const [sourceFileId, setSourceFileId] = useState("");
  const [presetId, setPresetId] = useState(defaultPreset || "");
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>(defaultAggressiveness);
  const [captionsEnabled, setCaptionsEnabled] = useState(defaultCaptions);
  const [generateShorts, setGenerateShorts] = useState(false);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Generate rough cut</CardTitle>
        <CardDescription>
          Keep the planning surface tight. Pick a source, choose a preset, add optional nuance, then run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
            <p className="text-sm leading-6 text-muted-foreground">{activePreset.description}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Aggressiveness</Label>
          <Select value={aggressiveness} onValueChange={(value) => setAggressiveness(value as Aggressiveness)}>
            <SelectTrigger>
              <SelectValue placeholder="Select pacing" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conservative">Conservative</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 rounded-[26px] bg-muted/80 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Burn captions into output</Label>
              <p className="mt-1 text-sm text-muted-foreground">Transcript and SRT are still exported either way.</p>
            </div>
            <Switch checked={captionsEnabled} onCheckedChange={setCaptionsEnabled} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Suggest shorts candidates</Label>
              <p className="mt-1 text-sm text-muted-foreground">Ask the planner to mark strong clip ideas in the plan.</p>
            </div>
            <Switch checked={generateShorts} onCheckedChange={setGenerateShorts} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Notes for the planner</Label>
          <Textarea
            placeholder="Examples: keep pauses natural, preserve humor, tighter pacing, protect the CTA."
            value={userNotes}
            onChange={(event) => setUserNotes(event.target.value)}
          />
        </div>

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
              generate_shorts: generateShorts,
              user_notes: userNotes.trim() || undefined
            })
          }
        >
          <WandSparkles className="mr-2 size-4" />
          {busy ? "Generating..." : "Generate rough cut"}
        </Button>
      </CardContent>
    </Card>
  );
}

