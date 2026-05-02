"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

import {
  applyStylePresetToDraft,
  CLIP_STYLE_PRESET_OPTIONS,
  clipStyleDraftFromOverrides,
  clipStyleDraftToOverrides,
  clipStyleProjectDefaultFromDraft,
  defaultHookText,
  deriveClipStyleDefaults,
  styleFromAnotherClip
} from "@/lib/clip-style";
import type {
  CandidateClip,
  ClipStyleDraft,
  ClipStyleOverrides,
  FileItem,
  PresetConfig
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ClipStyleCopySource {
  id: string;
  label: string;
  styleOverrides: ClipStyleOverrides;
}

interface ClipStyleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceJobId: string | null;
  candidate: CandidateClip | null;
  sourceFile: FileItem | null;
  preset: PresetConfig | null;
  activeOverrides?: ClipStyleOverrides | null;
  hasClipSpecificStyle?: boolean;
  copySources?: ClipStyleCopySource[];
  busy?: boolean;
  onSaveClipStyle: (overrides: ClipStyleOverrides | undefined, options?: { notify?: boolean }) => Promise<void> | void;
  onSaveProjectDefault: (overrides: ClipStyleOverrides | undefined, options?: { notify?: boolean }) => Promise<void> | void;
  onRender: (overrides: ClipStyleOverrides | undefined) => Promise<void> | void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isValidHexColor(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function resolvedHexColor(value: string, fallback: string) {
  return isValidHexColor(value) ? value.trim().toUpperCase() : fallback;
}

function normalizeWords(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function previewCaptionLines(words: string[], maxLines: number) {
  if (!words.length) {
    return [];
  }

  const lineCount = Math.min(maxLines, Math.max(1, Math.ceil(words.length / 4)));
  const lines: string[][] = [];
  let cursor = 0;
  let wordsRemaining = words.length;
  let linesRemaining = lineCount;

  while (cursor < words.length) {
    const take = Math.max(1, Math.ceil(wordsRemaining / Math.max(linesRemaining, 1)));
    const nextCursor = Math.min(words.length, cursor + take);
    lines.push(words.slice(cursor, nextCursor));
    wordsRemaining -= nextCursor - cursor;
    linesRemaining -= 1;
    cursor = nextCursor;
  }

  return lines;
}

function previewCaptionState(candidate: CandidateClip, playheadSec: number) {
  const activeSegment =
    candidate.subtitle_segments.find((segment) => playheadSec >= segment.start && playheadSec <= segment.end) ||
    candidate.subtitle_segments.find((segment) => segment.text.trim()) ||
    null;

  if (activeSegment) {
    const words = activeSegment.words.length
      ? activeSegment.words.map((word) => word.word.trim()).filter(Boolean)
      : normalizeWords(activeSegment.text);
    const activeWordIndex = activeSegment.words.findIndex((word) => playheadSec >= word.start && playheadSec <= word.end);
    return {
      words,
      activeWordIndex: activeWordIndex >= 0 ? activeWordIndex : 0
    };
  }

  const fallbackWords = normalizeWords(candidate.transcript_excerpt || candidate.hook_text || candidate.title);
  return { words: fallbackWords, activeWordIndex: 0 };
}

function captionTextShadow(outlineStrength: number, shadowStrength: number) {
  const outline = Math.max(0.4, outlineStrength * 0.3);
  const shadow = Math.max(1, shadowStrength * 2.4);
  return [
    `${outline}px 0 0 rgba(8,8,8,0.95)`,
    `-${outline}px 0 0 rgba(8,8,8,0.95)`,
    `0 ${outline}px 0 rgba(8,8,8,0.95)`,
    `0 -${outline}px 0 rgba(8,8,8,0.95)`,
    `0 ${shadow}px ${shadow * 1.2}px rgba(0,0,0,0.36)`
  ].join(", ");
}

function candidateLabel(candidate: CandidateClip) {
  return candidate.title.trim() || candidate.hook_text.trim() || "Selected clip";
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]"
      />
    </div>
  );
}

export function ClipStyleEditor({
  open,
  onOpenChange,
  sourceJobId,
  candidate,
  sourceFile,
  preset,
  activeOverrides,
  hasClipSpecificStyle = false,
  copySources = [],
  busy = false,
  onSaveClipStyle,
  onSaveProjectDefault,
  onRender
}: ClipStyleEditorProps) {
  const [draft, setDraft] = useState<ClipStyleDraft | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [savingClip, setSavingClip] = useState(false);
  const [savingProjectDefault, setSavingProjectDefault] = useState(false);
  const [copySelection, setCopySelection] = useState("__none__");
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const foregroundVideoRef = useRef<HTMLVideoElement | null>(null);

  const sourceUrl = sourceFile?.preview_url || sourceFile?.download_url || null;
  const sourceIsVideo = Boolean(sourceFile?.mime_type?.startsWith("video/"));
  const candidateDuration = candidate ? Math.max(1.6, candidate.end_sec - candidate.start_sec) : 0;
  const previewEndSec = candidate ? Math.min(candidate.end_sec, candidate.start_sec + Math.min(candidateDuration, 4.4)) : 0;

  useEffect(() => {
    if (!open || !candidate || !preset) {
      return;
    }
    setDraft(clipStyleDraftFromOverrides(candidate, preset, activeOverrides));
    setPlayheadSec(0);
    setPreviewNonce((current) => current + 1);
  }, [activeOverrides, candidate, open, preset]);

  useEffect(() => {
    if (!open || !candidate || !sourceIsVideo || !sourceUrl) {
      return;
    }

    const foreground = foregroundVideoRef.current;
    const background = backgroundVideoRef.current;
    if (!foreground || !background) {
      return;
    }

    const clipStart = Math.max(0, candidate.start_sec);
    const clipEnd = Math.max(clipStart + 1.2, previewEndSec);

    const seekAndPlay = () => {
      for (const video of [foreground, background]) {
        try {
          video.currentTime = clipStart;
        } catch {
          return;
        }
      }
      setPlayheadSec(0);
      void Promise.allSettled([foreground.play(), background.play()]);
    };

    const syncBackground = () => {
      if (Math.abs(background.currentTime - foreground.currentTime) > 0.12) {
        try {
          background.currentTime = foreground.currentTime;
        } catch {
          return;
        }
      }

      const relativeTime = clamp(foreground.currentTime - clipStart, 0, Math.max(0, clipEnd - clipStart));
      setPlayheadSec(relativeTime);

      if (foreground.currentTime >= clipEnd) {
        seekAndPlay();
      }
    };

    const syncPlay = () => {
      if (background.paused) {
        void background.play().catch(() => undefined);
      }
    };

    const syncPause = () => background.pause();
    const handleLoadedMetadata = () => seekAndPlay();

    foreground.addEventListener("loadedmetadata", handleLoadedMetadata);
    foreground.addEventListener("timeupdate", syncBackground);
    foreground.addEventListener("play", syncPlay);
    foreground.addEventListener("pause", syncPause);

    if (foreground.readyState >= 1 && background.readyState >= 1) {
      seekAndPlay();
    }

    return () => {
      foreground.pause();
      background.pause();
      foreground.removeEventListener("loadedmetadata", handleLoadedMetadata);
      foreground.removeEventListener("timeupdate", syncBackground);
      foreground.removeEventListener("play", syncPlay);
      foreground.removeEventListener("pause", syncPause);
    };
  }, [candidate?.id, candidate?.start_sec, open, previewEndSec, previewNonce, sourceIsVideo, sourceUrl]);

  if (!candidate || !preset || !draft) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Edit clip</DialogTitle>
            <DialogDescription>Select a ranked clip first to tune its banner, captions, and composition.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const previewDefaults = deriveClipStyleDefaults(candidate, preset, draft.stylePreset);
  const currentStyle = clipStyleDraftToOverrides(draft);
  const baselineStyle = clipStyleDraftToOverrides(clipStyleDraftFromOverrides(candidate, preset, activeOverrides));
  const projectDefaultStyle = clipStyleProjectDefaultFromDraft(draft);
  const hasUnsavedChanges = JSON.stringify(currentStyle) !== JSON.stringify(baselineStyle);
  const colorsValid = isValidHexColor(draft.captions.baseColor) && isValidHexColor(draft.captions.activeWordColor);
  const previewHookText = draft.hook.hookText.trim() || defaultHookText(candidate) || "Hook text";
  const captionPreview = previewCaptionState(candidate, playheadSec);
  const captionLines = previewCaptionLines(captionPreview.words, draft.captions.maxLines);

  async function handleRender() {
    try {
      setRendering(true);
      await onSaveClipStyle(currentStyle, { notify: false });
      await onRender(currentStyle);
    } finally {
      setRendering(false);
    }
  }

  async function handleSaveClipStyle() {
    try {
      setSavingClip(true);
      await onSaveClipStyle(currentStyle);
    } finally {
      setSavingClip(false);
    }
  }

  async function handleSaveProjectDefault() {
    try {
      setSavingProjectDefault(true);
      await onSaveProjectDefault(projectDefaultStyle);
    } finally {
      setSavingProjectDefault(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100vh-2.5rem)] w-[min(96vw,1320px)] max-w-none overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Edit clip</DialogTitle>
              <Badge variant="muted">{candidateLabel(candidate)}</Badge>
              <Badge variant={hasClipSpecificStyle ? "success" : "muted"}>
                {hasClipSpecificStyle ? "Clip-specific style" : activeOverrides ? "Using project default" : "Not saved yet"}
              </Badge>
              {hasUnsavedChanges ? <Badge variant="warning">Unsaved</Badge> : null}
            </div>
            <DialogDescription>
              Pick a built-in style, fine-tune only the high-leverage controls, then save or re-render. Final export still
              uses deterministic ffmpeg settings.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="rounded-[30px] border border-border/70 bg-card/72 p-4 shadow-soft">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="panel-label">Live Preview</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">Approximate browser preview of the hook banner, center blur fill, and captions.</p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewNonce((current) => current + 1)}>
                      Preview
                    </Button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[30px] border border-border/70 bg-black">
                    <div className="relative aspect-[9/16]">
                      {sourceIsVideo && sourceUrl ? (
                        <>
                          <video
                            ref={backgroundVideoRef}
                            key={`bg-${sourceFile?.id}-${candidate.id}-${previewNonce}`}
                            muted
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 h-full w-full scale-110 object-cover"
                            style={{
                              filter: `blur(${8 + draft.composition.blurIntensity * 0.42}px) brightness(0.82) saturate(0.88)`
                            }}
                            src={sourceUrl}
                          />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,6,5,0.12),rgba(7,6,5,0.32))]" />
                          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                            <video
                              ref={foregroundVideoRef}
                              key={`fg-${sourceFile?.id}-${candidate.id}-${previewNonce}`}
                              muted
                              playsInline
                              controls
                              preload="metadata"
                              className="h-full w-full object-contain"
                              style={{
                                transform: `translateY(${draft.composition.foregroundVerticalOffset * 0.18}px) scale(${draft.composition.foregroundScale})`
                              }}
                              src={sourceUrl}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(206,188,155,0.24),transparent_32%),linear-gradient(180deg,rgba(11,10,9,0.58),rgba(11,10,9,0.92))]" />
                      )}

                      <div
                        className="absolute left-1/2 z-10 -translate-x-1/2 rounded-[20px] bg-white/97 text-[#101010] shadow-[0_18px_52px_-36px_rgba(0,0,0,0.48)]"
                        style={{
                          top: `${(draft.hook.topOffset / 1920) * 100}%`,
                          width: `${clamp((draft.hook.boxWidth / 1080) * 100, 40, 88)}%`,
                          padding: `${draft.hook.boxPadding * 0.28}px ${draft.hook.boxPadding * 0.34}px`
                        }}
                      >
                        <p
                          className="whitespace-pre-wrap break-words font-semibold leading-[1.12]"
                          style={{
                            fontSize: `${draft.hook.fontSize * 0.34}px`,
                            textAlign: draft.hook.textAlignment,
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: draft.hook.maxLines,
                            overflow: "hidden"
                          }}
                        >
                          {previewHookText}
                        </p>
                      </div>

                      <div
                        className="absolute inset-x-0 z-10 px-5 text-center font-semibold"
                        style={{
                          bottom: `${(draft.captions.bottomOffset / 1920) * 100}%`,
                          fontSize: `${draft.captions.fontSize * 0.29}px`,
                          color: resolvedHexColor(draft.captions.baseColor, previewDefaults.captions.baseColor),
                          textShadow: captionTextShadow(draft.captions.outlineStrength, draft.captions.shadowStrength),
                          WebkitTextStroke: `${Math.max(0.4, draft.captions.outlineStrength * 0.16)}px rgba(8,8,8,0.92)`
                        }}
                      >
                        <div className={cn("mx-auto flex max-w-[88%] flex-col gap-1", draft.captions.verticalPosition === "lower_middle" ? "translate-y-[-30%]" : "")}>
                          {captionLines.length ? (
                            captionLines.map((line, lineIndex) => {
                              const offset = captionLines.slice(0, lineIndex).reduce((count, current) => count + current.length, 0);
                              return (
                                <p key={`${lineIndex}-${line.join("-")}`} className="leading-[1.08]">
                                  {line.map((word, wordIndex) => {
                                    const absoluteIndex = offset + wordIndex;
                                    return (
                                      <span
                                        key={`${word}-${absoluteIndex}`}
                                        style={{
                                          color:
                                            absoluteIndex === captionPreview.activeWordIndex
                                              ? resolvedHexColor(draft.captions.activeWordColor, previewDefaults.captions.activeWordColor)
                                              : resolvedHexColor(draft.captions.baseColor, previewDefaults.captions.baseColor)
                                        }}
                                      >
                                        {word}
                                        {wordIndex < line.length - 1 ? " " : ""}
                                      </span>
                                    );
                                  })}
                                </p>
                              );
                            })
                          ) : (
                            <p className="leading-[1.08]" style={{ color: resolvedHexColor(draft.captions.baseColor, previewDefaults.captions.baseColor) }}>
                              Captions preview
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    <span>{sourceIsVideo ? "Previewing source media" : "Previewing style only"}</span>
                    <span>{CLIP_STYLE_PRESET_OPTIONS.find((option) => option.id === draft.stylePreset)?.label || "Clean"} preset</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="panel-label">Style Presets</p>
                      <h3 className="mt-2 text-base font-semibold text-foreground">Choose a starting look</h3>
                    </div>
                    {copySources.length ? (
                      <div className="w-full max-w-[260px] space-y-2">
                        <Label>Copy style from</Label>
                        <Select
                          value={copySelection}
                          onValueChange={(value) => {
                            setCopySelection(value);
                            if (value === "__none__") {
                              return;
                            }
                            const source = copySources.find((item) => item.id === value);
                            if (source) {
                              setDraft(styleFromAnotherClip(candidate, preset, source.styleOverrides));
                            }
                            setCopySelection("__none__");
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Copy from saved style" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Choose saved style</SelectItem>
                            {copySources.map((source) => (
                              <SelectItem key={source.id} value={source.id}>
                                {source.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {CLIP_STYLE_PRESET_OPTIONS.map((option) => {
                      const active = draft.stylePreset === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={cn(
                            "rounded-[22px] border px-4 py-4 text-left transition",
                            active ? "border-primary/30 bg-primary/8 shadow-soft" : "border-border/70 bg-background/65 hover:bg-muted/65"
                          )}
                          onClick={() => setDraft(applyStylePresetToDraft(candidate, preset, draft, option.id))}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-foreground">{option.label}</span>
                            {active ? <Badge>Active</Badge> : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Hook</h3>
                  </div>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="hook-text">Text</Label>
                      <Textarea
                        id="hook-text"
                        value={draft.hook.hookText}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, hook: { ...current.hook, hookText: event.currentTarget.value } } : current
                          )
                        }
                        className="min-h-[110px]"
                      />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <RangeField
                        label="Top offset"
                        value={draft.hook.topOffset}
                        min={32}
                        max={520}
                        suffix="px"
                        onChange={(value) =>
                          setDraft((current) => (current ? { ...current, hook: { ...current.hook, topOffset: value } } : current))
                        }
                      />
                      <RangeField
                        label="Font size"
                        value={draft.hook.fontSize}
                        min={28}
                        max={96}
                        suffix="px"
                        onChange={(value) =>
                          setDraft((current) => (current ? { ...current, hook: { ...current.hook, fontSize: value } } : current))
                        }
                      />
                      <RangeField
                        label="Box width"
                        value={draft.hook.boxWidth}
                        min={320}
                        max={860}
                        suffix="px"
                        onChange={(value) =>
                          setDraft((current) => (current ? { ...current, hook: { ...current.hook, boxWidth: value } } : current))
                        }
                      />
                      <div className="space-y-2">
                        <Label>Max lines</Label>
                        <Select
                          value={String(draft.hook.maxLines)}
                          onValueChange={(value) =>
                            setDraft((current) => (current ? { ...current, hook: { ...current.hook, maxLines: Number(value) } } : current))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select max lines" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 line</SelectItem>
                            <SelectItem value="2">2 lines</SelectItem>
                            <SelectItem value="3">3 lines</SelectItem>
                            <SelectItem value="4">4 lines</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Captions</h3>
                  </div>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="base-color">Base color</Label>
                        <div className="flex items-center gap-3 rounded-[20px] border border-border/70 bg-background/70 px-3 py-2">
                          <input
                            id="base-color"
                            type="color"
                            value={resolvedHexColor(draft.captions.baseColor, previewDefaults.captions.baseColor)}
                            onChange={(event) =>
                              setDraft((current) =>
                                current ? { ...current, captions: { ...current.captions, baseColor: event.currentTarget.value.toUpperCase() } } : current
                              )
                            }
                            className="h-10 w-12 cursor-pointer rounded-xl border-0 bg-transparent p-0"
                          />
                          <Input
                            value={draft.captions.baseColor}
                            onChange={(event) =>
                              setDraft((current) =>
                                current ? { ...current, captions: { ...current.captions, baseColor: event.currentTarget.value.toUpperCase() } } : current
                              )
                            }
                            className="h-10 border-0 bg-transparent px-0 shadow-none focus:ring-0"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="active-color">Highlight color</Label>
                        <div className="flex items-center gap-3 rounded-[20px] border border-border/70 bg-background/70 px-3 py-2">
                          <input
                            id="active-color"
                            type="color"
                            value={resolvedHexColor(draft.captions.activeWordColor, previewDefaults.captions.activeWordColor)}
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? { ...current, captions: { ...current.captions, activeWordColor: event.currentTarget.value.toUpperCase() } }
                                  : current
                              )
                            }
                            className="h-10 w-12 cursor-pointer rounded-xl border-0 bg-transparent p-0"
                          />
                          <Input
                            value={draft.captions.activeWordColor}
                            onChange={(event) =>
                              setDraft((current) =>
                                current
                                  ? { ...current, captions: { ...current.captions, activeWordColor: event.currentTarget.value.toUpperCase() } }
                                  : current
                              )
                            }
                            className="h-10 border-0 bg-transparent px-0 shadow-none focus:ring-0"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <RangeField
                        label="Font size"
                        value={draft.captions.fontSize}
                        min={36}
                        max={120}
                        suffix="px"
                        onChange={(value) =>
                          setDraft((current) => (current ? { ...current, captions: { ...current.captions, fontSize: value } } : current))
                        }
                      />
                      <div className="space-y-2">
                        <Label>Vertical position</Label>
                        <Select
                          value={draft.captions.verticalPosition}
                          onValueChange={(value) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    captions: {
                                      ...current.captions,
                                      verticalPosition: value as ClipStyleDraft["captions"]["verticalPosition"],
                                      bottomOffset: value === "lower_middle" ? 420 : 300
                                    }
                                  }
                                : current
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select caption position" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lower">Lower</SelectItem>
                            <SelectItem value="lower_middle">Lower middle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Max lines</Label>
                        <Select
                          value={String(draft.captions.maxLines)}
                          onValueChange={(value) =>
                            setDraft((current) => (current ? { ...current, captions: { ...current.captions, maxLines: Number(value) } } : current))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select max lines" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 line</SelectItem>
                            <SelectItem value="2">2 lines</SelectItem>
                            <SelectItem value="3">3 lines</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Composition</h3>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <RangeField
                      label="Blur intensity"
                      value={draft.composition.blurIntensity}
                      min={0}
                      max={80}
                      step={0.5}
                      onChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, composition: { ...current.composition, blurIntensity: value } } : current
                        )
                      }
                    />
                    <RangeField
                      label="Foreground scale"
                      value={draft.composition.foregroundScale}
                      min={0.8}
                      max={1.3}
                      step={0.01}
                      onChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, composition: { ...current.composition, foregroundScale: value } } : current
                        )
                      }
                    />
                    <RangeField
                      label="Foreground vertical offset"
                      value={draft.composition.foregroundVerticalOffset}
                      min={-320}
                      max={320}
                      suffix="px"
                      onChange={(value) =>
                        setDraft((current) =>
                          current
                            ? { ...current, composition: { ...current.composition, foregroundVerticalOffset: value } }
                            : current
                        )
                      }
                    />
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                  <div className="flex items-center gap-2">
                    <Copy className="size-4 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Fine tuning</h3>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <RangeField
                      label="Box padding"
                      value={draft.hook.boxPadding}
                      min={12}
                      max={96}
                      suffix="px"
                      onChange={(value) =>
                        setDraft((current) => (current ? { ...current, hook: { ...current.hook, boxPadding: value } } : current))
                      }
                    />
                    <div className="space-y-2">
                      <Label>Hook alignment</Label>
                      <Select
                        value={draft.hook.textAlignment}
                        onValueChange={(value) =>
                          setDraft((current) =>
                            current
                              ? { ...current, hook: { ...current.hook, textAlignment: value as ClipStyleDraft["hook"]["textAlignment"] } }
                              : current
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select alignment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <RangeField
                      label="Caption bottom offset"
                      value={draft.captions.bottomOffset}
                      min={120}
                      max={760}
                      suffix="px"
                      onChange={(value) =>
                        setDraft((current) => (current ? { ...current, captions: { ...current.captions, bottomOffset: value } } : current))
                      }
                    />
                    <RangeField
                      label="Outline strength"
                      value={draft.captions.outlineStrength}
                      min={0}
                      max={12}
                      step={0.25}
                      onChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, captions: { ...current.captions, outlineStrength: value } } : current
                        )
                      }
                    />
                    <RangeField
                      label="Shadow strength"
                      value={draft.captions.shadowStrength}
                      min={0}
                      max={8}
                      step={0.25}
                      onChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, captions: { ...current.captions, shadowStrength: value } } : current
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-0 items-center justify-between border-t border-border/70 px-6 py-4">
            <p className="text-sm leading-6 text-muted-foreground">
              {colorsValid
                ? "Clip styles now persist with the project, and project defaults can be reused on later clips."
                : "Use full #RRGGBB values for caption colors before saving or re-rendering."}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPreviewNonce((current) => current + 1)}>
                Preview
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft((current) => {
                    if (!current) {
                      return current;
                    }
                    const next = deriveClipStyleDefaults(candidate, preset, current.stylePreset);
                    return {
                      ...next,
                      hook: {
                        ...next.hook,
                        hookText: current.hook.hookText
                      }
                    };
                  })
                }
              >
                <RotateCcw className="mr-2 size-4" />
                Reset to preset
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!colorsValid || !sourceJobId || !hasUnsavedChanges || savingClip || rendering || busy}
                onClick={() => void handleSaveClipStyle()}
              >
                {savingClip ? "Saving..." : "Save changes for this clip"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!colorsValid || savingProjectDefault || rendering || busy}
                onClick={() => void handleSaveProjectDefault()}
              >
                {savingProjectDefault ? "Saving..." : "Save as project default"}
              </Button>
              <Button type="button" disabled={!colorsValid || !sourceJobId || busy || rendering} onClick={() => void handleRender()}>
                {busy || rendering ? "Rendering..." : "Re-render"}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
