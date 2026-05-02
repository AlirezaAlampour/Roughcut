import type {
  CandidateClip,
  ClipStyleDraft,
  ClipStyleOverrides,
  ClipStylePresetId,
  PresetConfig
} from "@/lib/types";

type ClipStylePresetConfig = Omit<ClipStyleDraft, "stylePreset">;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeColor(value: string) {
  return value.trim().toUpperCase();
}

function normalizeStylePreset(value: ClipStylePresetId | null | undefined): ClipStylePresetId {
  if (value === "bold" || value === "aggressive") {
    return value;
  }
  return "clean";
}

export const CLIP_STYLE_PRESET_OPTIONS: Array<{
  id: ClipStylePresetId;
  label: string;
  description: string;
}> = [
  { id: "clean", label: "Clean", description: "Balanced banner, crisp captions, and a restrained center fill." },
  { id: "bold", label: "Bold", description: "Larger hook, stronger captions, and a slightly bigger foreground stage." },
  { id: "aggressive", label: "Aggressive", description: "Punchier framing, bigger text, and a more dramatic social-first composition." }
];

export function defaultHookText(candidate: CandidateClip) {
  return normalizeText(candidate.hook_text || candidate.title || "");
}

export function estimateHookBoxWidth(text: string, fontSize = 52, boxPadding = 36) {
  const longestLine = normalizeText(text)
    .split(/\n+/)
    .reduce((current, line) => Math.max(current, line.trim().length), 0);
  return clamp(Math.round(boxPadding * 4.5 + longestLine * fontSize * 0.52), 420, 760);
}

function clipStylePresetConfig(preset: PresetConfig, candidate: CandidateClip, stylePreset: ClipStylePresetId): ClipStylePresetConfig {
  const baseHookText = defaultHookText(candidate);
  const baseColors = {
    baseColor: normalizeColor(preset.caption_base_color),
    activeWordColor: normalizeColor(preset.caption_active_word_color)
  };

  if (stylePreset === "bold") {
    const fontSize = 58;
    const boxPadding = 38;
    return {
      hook: {
        hookText: baseHookText,
        fontSize,
        topOffset: 118,
        boxWidth: estimateHookBoxWidth(baseHookText, fontSize, boxPadding),
        boxPadding,
        maxLines: 3,
        textAlignment: "center"
      },
      captions: {
        ...baseColors,
        fontSize: 86,
        verticalPosition: "lower",
        bottomOffset: 284,
        maxLines: 2,
        outlineStrength: 5.5,
        shadowStrength: 2.2
      },
      composition: {
        blurIntensity: Math.max(18, preset.blur_intensity - 4),
        foregroundScale: 1.05,
        foregroundVerticalOffset: -18
      }
    };
  }

  if (stylePreset === "aggressive") {
    const fontSize = 64;
    const boxPadding = 34;
    return {
      hook: {
        hookText: baseHookText,
        fontSize,
        topOffset: 104,
        boxWidth: estimateHookBoxWidth(baseHookText, fontSize, boxPadding),
        boxPadding,
        maxLines: 2,
        textAlignment: "center"
      },
      captions: {
        ...baseColors,
        fontSize: 92,
        verticalPosition: "lower_middle",
        bottomOffset: 388,
        maxLines: 2,
        outlineStrength: 6,
        shadowStrength: 2.5
      },
      composition: {
        blurIntensity: Math.min(80, preset.blur_intensity + 10),
        foregroundScale: 1.1,
        foregroundVerticalOffset: -46
      }
    };
  }

  const cleanFontSize = 52;
  const cleanBoxPadding = 36;
  const cleanVerticalPosition = preset.caption_vertical_position;
  return {
    hook: {
      hookText: baseHookText,
      fontSize: cleanFontSize,
      topOffset: 132,
      boxWidth: estimateHookBoxWidth(baseHookText, cleanFontSize, cleanBoxPadding),
      boxPadding: cleanBoxPadding,
      maxLines: 3,
      textAlignment: "center"
    },
    captions: {
      ...baseColors,
      fontSize: 78,
      verticalPosition: cleanVerticalPosition,
      bottomOffset: cleanVerticalPosition === "lower_middle" ? 420 : 300,
      maxLines: preset.caption_max_lines,
      outlineStrength: 5,
      shadowStrength: 2
    },
    composition: {
      blurIntensity: preset.blur_intensity,
      foregroundScale: 1,
      foregroundVerticalOffset: 0
    }
  };
}

export function deriveClipStyleDefaults(
  candidate: CandidateClip,
  preset: PresetConfig,
  stylePreset: ClipStylePresetId = "clean"
): ClipStyleDraft {
  const normalizedPreset = normalizeStylePreset(stylePreset);
  const defaults = clipStylePresetConfig(preset, candidate, normalizedPreset);
  return {
    stylePreset: normalizedPreset,
    hook: defaults.hook,
    captions: defaults.captions,
    composition: defaults.composition
  };
}

export function clipStyleDraftFromOverrides(
  candidate: CandidateClip,
  preset: PresetConfig,
  styleOverrides?: ClipStyleOverrides | null
): ClipStyleDraft {
  const stylePreset = normalizeStylePreset(styleOverrides?.style_preset);
  const defaults = deriveClipStyleDefaults(candidate, preset, stylePreset);

  return {
    stylePreset,
    hook: {
      hookText: styleOverrides?.hook?.hook_text ?? defaults.hook.hookText,
      fontSize: styleOverrides?.hook?.font_size ?? defaults.hook.fontSize,
      topOffset: styleOverrides?.hook?.top_offset ?? defaults.hook.topOffset,
      boxWidth: styleOverrides?.hook?.box_width ?? defaults.hook.boxWidth,
      boxPadding: styleOverrides?.hook?.box_padding ?? defaults.hook.boxPadding,
      maxLines: styleOverrides?.hook?.max_lines ?? defaults.hook.maxLines,
      textAlignment: styleOverrides?.hook?.text_alignment ?? defaults.hook.textAlignment
    },
    captions: {
      baseColor: normalizeColor(styleOverrides?.captions?.base_color ?? defaults.captions.baseColor),
      activeWordColor: normalizeColor(styleOverrides?.captions?.active_word_color ?? defaults.captions.activeWordColor),
      fontSize: styleOverrides?.captions?.font_size ?? defaults.captions.fontSize,
      verticalPosition: styleOverrides?.captions?.vertical_position ?? defaults.captions.verticalPosition,
      bottomOffset: styleOverrides?.captions?.bottom_offset ?? defaults.captions.bottomOffset,
      maxLines: styleOverrides?.captions?.max_lines ?? defaults.captions.maxLines,
      outlineStrength: styleOverrides?.captions?.outline_strength ?? defaults.captions.outlineStrength,
      shadowStrength: styleOverrides?.captions?.shadow_strength ?? defaults.captions.shadowStrength
    },
    composition: {
      blurIntensity: styleOverrides?.composition?.blur_intensity ?? defaults.composition.blurIntensity,
      foregroundScale: styleOverrides?.composition?.foreground_scale ?? defaults.composition.foregroundScale,
      foregroundVerticalOffset:
        styleOverrides?.composition?.foreground_vertical_offset ?? defaults.composition.foregroundVerticalOffset
    }
  };
}

export function clipStyleDraftToOverrides(
  draft: ClipStyleDraft,
  options?: {
    omitHookText?: boolean;
  }
): ClipStyleOverrides {
  return {
    style_preset: draft.stylePreset,
    hook: {
      ...(options?.omitHookText ? {} : { hook_text: normalizeText(draft.hook.hookText) || undefined }),
      font_size: draft.hook.fontSize,
      top_offset: draft.hook.topOffset,
      box_width: draft.hook.boxWidth,
      box_padding: draft.hook.boxPadding,
      max_lines: draft.hook.maxLines,
      text_alignment: draft.hook.textAlignment
    },
    captions: {
      base_color: normalizeColor(draft.captions.baseColor),
      active_word_color: normalizeColor(draft.captions.activeWordColor),
      font_size: draft.captions.fontSize,
      vertical_position: draft.captions.verticalPosition,
      bottom_offset: draft.captions.bottomOffset,
      max_lines: draft.captions.maxLines,
      outline_strength: draft.captions.outlineStrength,
      shadow_strength: draft.captions.shadowStrength
    },
    composition: {
      blur_intensity: draft.composition.blurIntensity,
      foreground_scale: draft.composition.foregroundScale,
      foreground_vertical_offset: draft.composition.foregroundVerticalOffset
    }
  };
}

export function clipStyleProjectDefaultFromDraft(draft: ClipStyleDraft): ClipStyleOverrides {
  const style = clipStyleDraftToOverrides(draft, { omitHookText: true });
  if (style.hook && !Object.keys(style.hook).length) {
    delete style.hook;
  }
  return style;
}

export function applyStylePresetToDraft(
  candidate: CandidateClip,
  preset: PresetConfig,
  currentDraft: ClipStyleDraft,
  stylePreset: ClipStylePresetId
): ClipStyleDraft {
  const presetDraft = deriveClipStyleDefaults(candidate, preset, stylePreset);
  return {
    ...presetDraft,
    hook: {
      ...presetDraft.hook,
      hookText: currentDraft.hook.hookText
    }
  };
}

export function styleFromAnotherClip(
  candidate: CandidateClip,
  preset: PresetConfig,
  styleOverrides: ClipStyleOverrides
): ClipStyleDraft {
  const copiedDraft = clipStyleDraftFromOverrides(candidate, preset, styleOverrides);
  return {
    ...copiedDraft,
    hook: {
      ...copiedDraft.hook,
      hookText: defaultHookText(candidate)
    }
  };
}

export function clipStyleOverrideCount(overrides: ClipStyleOverrides | null | undefined) {
  if (!overrides) {
    return 0;
  }

  const groupCount =
    (overrides.hook ? Object.keys(overrides.hook).length : 0) +
    (overrides.captions ? Object.keys(overrides.captions).length : 0) +
    (overrides.composition ? Object.keys(overrides.composition).length : 0);

  return groupCount + (overrides.style_preset ? 1 : 0);
}

export function hasClipStyleOverrides(overrides: ClipStyleOverrides | null | undefined) {
  return clipStyleOverrideCount(overrides) > 0;
}
