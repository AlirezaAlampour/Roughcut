"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

import {
  applyStylePresetToDraft,
  CLIP_STYLE_PRESET_OPTIONS,
  clipStyleDraftFromOverrides,
  clipStyleDraftToOverrides,
  clipStyleProjectDefaultFromDraft,
  defaultCaptionBottomOffset,
  defaultHookText,
  deriveClipStyleDefaults,
  styleFromAnotherClip
} from "@/lib/clip-style";
import type {
  CandidateClip,
  ClipStyleDraft,
  ClipStyleOverrides,
  FileItem,
  PresetConfig,
  SubtitleSegment
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  isQuickCaptionMode?: boolean;
  onSaveClipStyle: (overrides: ClipStyleOverrides | undefined, options?: { notify?: boolean }) => Promise<void> | void;
  onSaveProjectDefault: (overrides: ClipStyleOverrides | undefined, options?: { notify?: boolean }) => Promise<void> | void;
  onRender: (overrides: ClipStyleOverrides | undefined, subtitleSegments?: SubtitleSegment[]) => Promise<void> | void;
}

const CAPTION_DISPLAY_MODE_OPTIONS: Array<{
  value: ClipStyleDraft["captions"]["displayMode"];
  label: string;
}> = [
  { value: "karaoke", label: "Karaoke (Highlight Word)" },
  { value: "word", label: "1 Word at a Time" },
  { value: "sentence", label: "Full Sentence" }
];

const CAPTION_FONT_FAMILY_OPTIONS = [
  { value: "system-ui", label: "System Default" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Impact", label: "Impact" },
  { value: "Bangers", label: "Bangers" }
];

const PROJECT_DEFAULT_PREVIEW_CANDIDATE: CandidateClip = {
  id: "__project_default_preview__",
  start_sec: 0,
  end_sec: 4.4,
  transcript_excerpt: "This is a preview of your default caption style.",
  title: "Project default preview",
  hook_text: "",
  rationale: "",
  score_total: 0,
  score_breakdown: null,
  tags: [],
  duplicate_group: null,
  subtitle_segments: []
};

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

function roundTimestamp(value: number) {
  return Math.round(value * 1000) / 1000;
}

function derivedWordsForEditedSegment(segment: SubtitleSegment, text: string) {
  const tokens = normalizeWords(text);
  if (!tokens.length) {
    return [];
  }

  if (segment.words.length === tokens.length) {
    return segment.words.map((word, index) => ({
      ...word,
      word: tokens[index]
    }));
  }

  const duration = Math.max(0.2, segment.end - segment.start);
  const step = duration / tokens.length;
  return tokens.map((token, index) => ({
    start: roundTimestamp(segment.start + index * step),
    end: roundTimestamp(segment.start + (index + 1) * step),
    word: token
  }));
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
      sentence: activeSegment.text.trim() || words.join(" "),
      activeWordIndex: clamp(activeWordIndex >= 0 ? activeWordIndex : 0, 0, Math.max(0, words.length - 1))
    };
  }

  const fallbackWords = normalizeWords(candidate.transcript_excerpt || candidate.hook_text || candidate.title);
  return {
    words: fallbackWords,
    sentence: fallbackWords.join(" "),
    activeWordIndex: 0
  };
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

function hookPreviewBoxClass(backgroundStyle: ClipStyleDraft["hook"]["backgroundStyle"]) {
  if (backgroundStyle === "dark") {
    return "bg-black/82 text-white shadow-[0_18px_52px_-36px_rgba(0,0,0,0.72)]";
  }
  if (backgroundStyle === "transparent") {
    return "bg-transparent text-white shadow-none";
  }
  return "bg-white/97 text-[#101010] shadow-[0_18px_52px_-36px_rgba(0,0,0,0.48)]";
}

function resolvedCaptionFontFamily(fontFamily: string) {
  if (fontFamily === "Montserrat") {
    return "var(--font-caption-montserrat), var(--font-sans), sans-serif";
  }
  if (fontFamily === "Impact") {
    return 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
  }
  if (fontFamily === "Bangers") {
    return "var(--font-caption-bangers), var(--font-sans), cursive";
  }
  return "system-ui, var(--font-sans), sans-serif";
}

function draftForQuickCaptionMode(draft: ClipStyleDraft): ClipStyleDraft {
  return {
    ...draft,
    hook: {
      ...draft.hook,
      hookText: ""
    },
    composition: {
      blurIntensity: 0,
      foregroundScale: 1,
      foregroundVerticalOffset: 0
    }
  };
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
  isQuickCaptionMode = false,
  onSaveClipStyle,
  onSaveProjectDefault,
  onRender
}: ClipStyleEditorProps) {
  const [draft, setDraft] = useState<ClipStyleDraft | null>(null);
  const [editableCandidate, setEditableCandidate] = useState<CandidateClip | null>(null);
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
  const styleCandidate = candidate ?? PROJECT_DEFAULT_PREVIEW_CANDIDATE;
  const editingProjectDefaultOnly = candidate === null;

  useEffect(() => {
    if (!open || !preset) {
      return;
    }
    setDraft(clipStyleDraftFromOverrides(styleCandidate, preset, activeOverrides));
    setEditableCandidate({
      ...styleCandidate,
      subtitle_segments: styleCandidate.subtitle_segments.map((segment) => ({
        ...segment,
        words: segment.words.map((word) => ({ ...word }))
      }))
    });
    setPlayheadSec(0);
    setPreviewNonce((current) => current + 1);
  }, [activeOverrides, open, preset, styleCandidate]);

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

  if (!preset || !draft || !editableCandidate) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Edit style</DialogTitle>
            <DialogDescription>Style controls will appear once Roughcut has loaded the active preset.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const previewCandidate = editableCandidate;
  const previewDefaults = deriveClipStyleDefaults(styleCandidate, preset, draft.stylePreset);
  const effectiveDraft = isQuickCaptionMode ? draftForQuickCaptionMode(draft) : draft;
  const baselineDraft = clipStyleDraftFromOverrides(styleCandidate, preset, activeOverrides);
  const effectiveBaselineDraft = isQuickCaptionMode ? draftForQuickCaptionMode(baselineDraft) : baselineDraft;
  const currentStyle = clipStyleDraftToOverrides(effectiveDraft);
  const baselineStyle = clipStyleDraftToOverrides(effectiveBaselineDraft);
  const projectDefaultStyle = clipStyleProjectDefaultFromDraft(effectiveDraft);
  const hasUnsavedChanges = JSON.stringify(currentStyle) !== JSON.stringify(baselineStyle);
  const colorsValid = isValidHexColor(draft.captions.baseColor) && isValidHexColor(draft.captions.activeWordColor);
  const previewHookText = draft.hook.hookText.trim() || defaultHookText(previewCandidate) || "Hook text";
  const captionPreview = previewCaptionState(previewCandidate, playheadSec);
  const captionLines = previewCaptionLines(captionPreview.words, draft.captions.maxLines);
  const captionBaseColor = resolvedHexColor(draft.captions.baseColor, previewDefaults.captions.baseColor);
  const captionActiveColor = resolvedHexColor(draft.captions.activeWordColor, previewDefaults.captions.activeWordColor);
  const captionActiveWord = captionPreview.words[captionPreview.activeWordIndex] || captionPreview.words[0] || "Captions preview";
  const captionFontFamily = resolvedCaptionFontFamily(draft.captions.fontFamily);
  const previewComposition = isQuickCaptionMode
    ? { blurIntensity: 0, foregroundScale: 1, foregroundVerticalOffset: 0 }
    : draft.composition;

  async function handleRender() {
    try {
      setRendering(true);
      await onSaveClipStyle(currentStyle, { notify: false });
      await onRender(currentStyle, previewCandidate.subtitle_segments);
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

  async function handleQuickCaptionSaveAndRender() {
    try {
      setSavingClip(true);
      await onSaveClipStyle(currentStyle);
      setSavingClip(false);
      setRendering(true);
      await onRender(currentStyle, previewCandidate.subtitle_segments);
    } finally {
      setSavingClip(false);
      setRendering(false);
    }
  }

  function handleSubtitleSegmentChange(segmentIndex: number, text: string) {
    setEditableCandidate((current) =>
      current
        ? {
            ...current,
            subtitle_segments: current.subtitle_segments.map((segment, index) =>
              index === segmentIndex
                ? {
                    ...segment,
                    text,
                    words: derivedWordsForEditedSegment(segment, text)
                  }
                : segment
            )
          }
        : current
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100vh-2.5rem)] w-[min(96vw,1320px)] max-w-none overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{editingProjectDefaultOnly ? "Edit project default style" : "Edit clip"}</DialogTitle>
              <Badge variant="muted">{candidateLabel(previewCandidate)}</Badge>
              <Badge variant={hasClipSpecificStyle ? "success" : "muted"}>
                {editingProjectDefaultOnly
                  ? activeOverrides
                    ? "Project default"
                    : "Unsaved project default"
                  : hasClipSpecificStyle
                    ? "Clip-specific style"
                    : activeOverrides
                      ? "Using project default"
                      : "Not saved yet"}
              </Badge>
              {hasUnsavedChanges ? <Badge variant="warning">Unsaved</Badge> : null}
            </div>
            <DialogDescription>
              {editingProjectDefaultOnly
                ? "Tune the shared caption look once, save it as the project default, then batch render completed clips."
                : "Pick a built-in style, fine-tune only the high-leverage controls, then save or re-render. Final export still uses deterministic ffmpeg settings."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="rounded-[30px] border border-border/70 bg-card/72 p-4 shadow-soft">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="panel-label">Live Preview</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {isQuickCaptionMode
                          ? "Approximate browser preview of the caption timing and type treatment."
                          : "Approximate browser preview of the hook banner, center blur fill, and captions."}
                      </p>
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
                            key={`bg-${sourceFile?.id}-${styleCandidate.id}-${previewNonce}`}
                            muted
                            playsInline
                            preload="metadata"
                            className={cn(
                              "absolute inset-0 h-full w-full",
                              isQuickCaptionMode ? "object-contain" : "scale-110 object-cover"
                            )}
                            style={{
                              filter: isQuickCaptionMode
                                ? "none"
                                : `blur(${8 + previewComposition.blurIntensity * 0.42}px) brightness(0.82) saturate(0.88)`
                            }}
                            src={sourceUrl}
                          />
                          {!isQuickCaptionMode ? (
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,6,5,0.12),rgba(7,6,5,0.32))]" />
                          ) : null}
                          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                            <video
                              ref={foregroundVideoRef}
                              key={`fg-${sourceFile?.id}-${styleCandidate.id}-${previewNonce}`}
                              muted
                              playsInline
                              controls
                              preload="metadata"
                              className="h-full w-full object-contain"
                              style={{
                                transform: `translateY(${previewComposition.foregroundVerticalOffset * 0.18}px) scale(${previewComposition.foregroundScale})`
                              }}
                              src={sourceUrl}
                            />
                          </div>
                        </>
                      ) : (
                        <div
                          className={cn(
                            "absolute inset-0",
                            editingProjectDefaultOnly
                              ? "bg-black"
                              : "bg-[radial-gradient(circle_at_top,rgba(206,188,155,0.24),transparent_32%),linear-gradient(180deg,rgba(11,10,9,0.58),rgba(11,10,9,0.92))]"
                          )}
                        />
                      )}

                      {!isQuickCaptionMode ? (
                        <div
                          className={cn(
                            "absolute left-1/2 z-10 -translate-x-1/2 rounded-[20px]",
                            hookPreviewBoxClass(draft.hook.backgroundStyle)
                          )}
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
                      ) : null}

                      <div
                        className="absolute inset-x-0 z-10 px-5 text-center font-semibold"
                        style={{
                          bottom: `${(draft.captions.bottomOffset / 1920) * 100}%`,
                          fontSize: `${draft.captions.fontSize * 0.29}px`,
                          color: captionBaseColor,
                          textShadow: captionTextShadow(draft.captions.outlineStrength, draft.captions.shadowStrength),
                          WebkitTextStroke: `${Math.max(0.4, draft.captions.outlineStrength * 0.16)}px rgba(8,8,8,0.92)`
                        }}
                      >
                        <div className="mx-auto max-w-[88%]" style={{ fontFamily: captionFontFamily }}>
                          {draft.captions.displayMode === "word" ? (
                            <p
                              className="inline-block break-words leading-[1.02]"
                              style={{
                                color: captionActiveColor,
                                transform: "scale(1.06)"
                              }}
                            >
                              {captionActiveWord}
                            </p>
                          ) : draft.captions.displayMode === "sentence" ? (
                            captionLines.length ? (
                              captionLines.map((line, lineIndex) => (
                                <p key={`${lineIndex}-${line.join("-")}`} className="leading-[1.08] break-words">
                                  {line.join(" ")}
                                </p>
                              ))
                            ) : (
                              <p className="leading-[1.08] break-words">{captionPreview.sentence || "Captions preview"}</p>
                            )
                          ) : captionLines.length ? (
                            <div className="flex flex-col gap-1">
                              {captionLines.map((line, lineIndex) => {
                                const offset = captionLines.slice(0, lineIndex).reduce((count, current) => count + current.length, 0);
                                return (
                                  <p key={`${lineIndex}-${line.join("-")}`} className="leading-[1.08] break-words">
                                    {line.map((word, wordIndex) => {
                                      const absoluteIndex = offset + wordIndex;
                                      const active = absoluteIndex === captionPreview.activeWordIndex;
                                      return (
                                        <span
                                          key={`${word}-${absoluteIndex}`}
                                          className="inline-block"
                                          style={{
                                            color: active ? captionActiveColor : captionBaseColor,
                                            transform: active ? "scale(1.05)" : "scale(1)",
                                            transition: "all 0.1s ease-in-out"
                                          }}
                                        >
                                          {word}
                                          {wordIndex < line.length - 1 ? " " : ""}
                                        </span>
                                      );
                                    })}
                                  </p>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="leading-[1.08] break-words">Captions preview</p>
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
                  <Tabs defaultValue="captions" className="w-full">
                    <TabsList>
                      <TabsTrigger value="presets">Presets</TabsTrigger>
                      <TabsTrigger value="captions">Captions</TabsTrigger>
                      {!isQuickCaptionMode ? <TabsTrigger value="hook">Hook</TabsTrigger> : null}
                      {!isQuickCaptionMode ? <TabsTrigger value="stage">Stage</TabsTrigger> : null}
                    </TabsList>

                    <TabsContent value="presets" className="space-y-4">
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
                                  setDraft(styleFromAnotherClip(styleCandidate, preset, source.styleOverrides));
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

                      <div className="grid gap-3 lg:grid-cols-3">
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
                              onClick={() => setDraft(applyStylePresetToDraft(styleCandidate, preset, draft, option.id))}
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
                    </TabsContent>

                    <TabsContent value="captions" className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <h3 className="text-base font-semibold text-foreground">Captions</h3>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="base-color">Base color</Label>
                          <div className="flex items-center gap-3 rounded-[20px] border border-border/70 bg-background/70 px-3 py-2">
                            <input
                              id="base-color"
                              type="color"
                              value={captionBaseColor}
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
                              value={captionActiveColor}
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

                        <div className="space-y-2">
                          <Label>Display mode</Label>
                          <Select
                            value={draft.captions.displayMode}
                            onValueChange={(value) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      captions: {
                                        ...current.captions,
                                        displayMode: value as ClipStyleDraft["captions"]["displayMode"]
                                      }
                                    }
                                  : current
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select display mode" />
                            </SelectTrigger>
                            <SelectContent>
                              {CAPTION_DISPLAY_MODE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Font family</Label>
                          <Select
                            value={draft.captions.fontFamily}
                            onValueChange={(value) =>
                              setDraft((current) =>
                                current ? { ...current, captions: { ...current.captions, fontFamily: value } } : current
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select font family" />
                            </SelectTrigger>
                            <SelectContent>
                              {CAPTION_FONT_FAMILY_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                                        bottomOffset: defaultCaptionBottomOffset(value as ClipStyleDraft["captions"]["verticalPosition"])
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
                              <SelectItem value="center">Center</SelectItem>
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

                      <div className="rounded-[24px] border border-border/70 bg-background/55 p-4">
                        <div>
                          <p className="panel-label">Transcript Corrections</p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Correct caption typos here. These updates feed the live preview and the next re-render for this clip.
                          </p>
                        </div>
                        {previewCandidate.subtitle_segments.length ? (
                          <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                            {previewCandidate.subtitle_segments.map((segment, index) => (
                              <div key={`${segment.start}-${segment.end}-${index}`} className="space-y-2 rounded-[20px] border border-border/60 bg-card/80 p-3">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Segment {index + 1} · {segment.start.toFixed(1)}s to {segment.end.toFixed(1)}s
                                </div>
                                <Input value={segment.text} onChange={(event) => handleSubtitleSegmentChange(index, event.currentTarget.value)} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm leading-6 text-muted-foreground">
                            {editingProjectDefaultOnly
                              ? "Transcript corrections become available after a clip has been transcribed."
                              : "No subtitle segments were generated for this clip."}
                          </p>
                        )}
                      </div>
                    </TabsContent>

                    {!isQuickCaptionMode ? (
                      <TabsContent value="hook" className="space-y-4">
                        <div className="flex items-center gap-2">
                          <SlidersHorizontal className="size-4 text-primary" />
                          <h3 className="text-base font-semibold text-foreground">Hook</h3>
                        </div>

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
                            <Label>Max lines</Label>
                            <Select
                              value={String(draft.hook.maxLines)}
                              onValueChange={(value) =>
                                setDraft((current) => (current ? { ...current, hook: { ...current.hook, maxLines: Number(value) } } : current))
                              }
                            >
                              <SelectTrigger className="h-10">
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
                          <div className="space-y-2">
                            <Label>Text alignment</Label>
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
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select alignment" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="left">Left</SelectItem>
                                <SelectItem value="center">Center</SelectItem>
                                <SelectItem value="right">Right</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Background color</Label>
                            <Select
                              value={draft.hook.backgroundStyle}
                              onValueChange={(value) =>
                                setDraft((current) =>
                                  current
                                    ? { ...current, hook: { ...current.hook, backgroundStyle: value as ClipStyleDraft["hook"]["backgroundStyle"] } }
                                    : current
                                )
                              }
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select background style" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="light">White (Light)</SelectItem>
                                <SelectItem value="dark">Black (Dark)</SelectItem>
                                <SelectItem value="transparent">Transparent</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </TabsContent>
                    ) : null}

                    {!isQuickCaptionMode ? (
                      <TabsContent value="stage" className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 text-primary" />
                          <h3 className="text-base font-semibold text-foreground">Stage</h3>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
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
                      </TabsContent>
                    ) : null}
                  </Tabs>
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
                    const next = deriveClipStyleDefaults(styleCandidate, preset, current.stylePreset);
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
              {!isQuickCaptionMode ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!colorsValid || !sourceJobId || !hasUnsavedChanges || savingClip || rendering || busy}
                  onClick={() => void handleSaveClipStyle()}
                >
                  {savingClip ? "Saving..." : "Save changes for this clip"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={!colorsValid || savingProjectDefault || rendering || busy}
                onClick={() => void handleSaveProjectDefault()}
              >
                {savingProjectDefault ? "Saving..." : "Save as project default"}
              </Button>
              {isQuickCaptionMode ? (
                <Button
                  type="button"
                  disabled={!colorsValid || !sourceJobId || busy || rendering || savingClip}
                  onClick={() => void handleQuickCaptionSaveAndRender()}
                >
                  {busy || rendering || savingClip ? "Saving & Rendering..." : "Save & Render Video"}
                </Button>
              ) : (
                <Button type="button" disabled={!colorsValid || !sourceJobId || busy || rendering} onClick={() => void handleRender()}>
                  {busy || rendering ? "Rendering..." : "Re-render"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
