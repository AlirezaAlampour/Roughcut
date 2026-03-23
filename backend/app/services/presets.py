from __future__ import annotations

import json
from pathlib import Path

from app.config import Settings
from app.schemas import PresetConfig

DEFAULT_PRESETS = [
    PresetConfig(
        id="talking_head_clean",
        name="Talking Head Clean",
        description="Tighten a direct-to-camera video while keeping it natural and confident.",
        silence_threshold_db=-38,
        minimum_silence_duration=0.45,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="clean_minimal",
        zoom_rule="Subtle punch-ins only on emphasis beats.",
        shorts_behavior="Disabled by default unless the user asks for candidates.",
        cta_preservation="Preserve intro hook and final CTA if present.",
        planner_hint="Prioritize clarity, hooks, and a premium talking-head rhythm.",
    ),
    PresetConfig(
        id="faceless_explainer",
        name="Faceless Explainer",
        description="Keep narration dense and economical for visual-over-text explainers.",
        silence_threshold_db=-42,
        minimum_silence_duration=0.35,
        filler_removal_aggressiveness="high",
        cut_aggressiveness="aggressive",
        caption_style="clean_minimal",
        zoom_rule="Use zooms sparingly; focus on pace over motion.",
        shorts_behavior="Highlight high-information segments for repurposing.",
        cta_preservation="Preserve direct value proposition and end CTA.",
        planner_hint="Favor concise pacing and remove throat-clearing quickly.",
    ),
    PresetConfig(
        id="podcast_to_shorts",
        name="Podcast to Shorts",
        description="Mine longer conversational audio for compact, hook-first clips.",
        silence_threshold_db=-40,
        minimum_silence_duration=0.3,
        filler_removal_aggressiveness="high",
        cut_aggressiveness="aggressive",
        caption_style="shorts_bold",
        zoom_rule="Allow stronger punch-ins when a clip has a clear hook.",
        shorts_behavior="Find multiple clip candidates around quotable moments.",
        cta_preservation="Only preserve CTAs if they serve the clip.",
        planner_hint="Prefer high-contrast opinions, hooks, and concise story arcs.",
    ),
    PresetConfig(
        id="tutorial_fast_cut",
        name="Tutorial Fast Cut",
        description="Reduce dead air and repetition while preserving instructional clarity.",
        silence_threshold_db=-36,
        minimum_silence_duration=0.4,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="clean_minimal",
        zoom_rule="Avoid decorative zooms unless reinforcing a key step.",
        shorts_behavior="Suggest short clip candidates for the strongest tips.",
        cta_preservation="Preserve setup, key steps, and recap CTA.",
        planner_hint="Keep the flow instructional; do not cut away key steps or setup context.",
    ),
    PresetConfig(
        id="minimal_longform",
        name="Minimal Longform",
        description="Keep pacing natural and preserve breathing room for longer content.",
        silence_threshold_db=-34,
        minimum_silence_duration=0.55,
        filler_removal_aggressiveness="low",
        cut_aggressiveness="conservative",
        caption_style="clean_minimal",
        zoom_rule="Avoid zoom effects unless explicitly justified.",
        shorts_behavior="Only suggest standout clip moments, not many variants.",
        cta_preservation="Preserve intros, transitions, and end CTA.",
        planner_hint="Be conservative, keep pauses that feel human, and preserve longform flow.",
    ),
]


def _preset_file(settings: Settings) -> Path:
    return settings.config_root / "presets.json"


def list_presets(settings: Settings) -> list[PresetConfig]:
    presets = {preset.id: preset for preset in DEFAULT_PRESETS}
    custom_file = _preset_file(settings)
    if custom_file.exists():
        try:
            payload = json.loads(custom_file.read_text())
            for item in payload if isinstance(payload, list) else payload.get("items", []):
                preset = PresetConfig.model_validate(item)
                presets[preset.id] = preset
        except Exception:
            pass
    return list(presets.values())


def get_preset(settings: Settings, preset_id: str) -> PresetConfig | None:
    for preset in list_presets(settings):
        if preset.id == preset_id:
            return preset
    return None

