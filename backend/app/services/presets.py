from __future__ import annotations

import json
from pathlib import Path

from app.config import Settings
from app.schemas import PresetConfig

DEFAULT_PRESETS = [
    PresetConfig(
        id="tacdel_builder_story",
        name="Tacdel Builder Story",
        description="Find compact builder-story moments with a clear setup, friction point, and practical payoff.",
        silence_threshold_db=-38,
        minimum_silence_duration=0.4,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="shorts_clean",
        zoom_rule="No automatic face tracking; export vertical shorts with safe centered framing.",
        shorts_behavior="Generate several self-contained story candidates, not one final edit.",
        cta_preservation="Preserve CTAs only when they make the short self-contained.",
        planner_hint="Prioritize creator/building stories with a strong first sentence and concrete lesson.",
        target_clip_min_sec=28,
        target_clip_max_sec=75,
        target_clip_ideal_sec=48,
        candidate_overlap_sec=6,
        max_candidates=12,
        scoring_weights={
            "hook_strength": 1.25,
            "self_containedness": 1.15,
            "conflict_tension": 1.1,
            "payoff_clarity": 1.15,
            "niche_relevance": 1.05,
        },
    ),
    PresetConfig(
        id="ai_brutal_truth",
        name="AI Brutal Truth",
        description="Rank blunt, high-contrast AI takes that can stand alone as opinionated shorts.",
        silence_threshold_db=-40,
        minimum_silence_duration=0.35,
        filler_removal_aggressiveness="high",
        cut_aggressiveness="aggressive",
        caption_style="shorts_clean",
        zoom_rule="Use deterministic vertical framing only.",
        shorts_behavior="Favor punchy claims, tension, and clear payoff.",
        cta_preservation="Skip CTAs unless the clip naturally lands on one.",
        planner_hint="Look for hard truths, contrarian opinions, and moments that would make an AI builder stop scrolling.",
        target_clip_min_sec=20,
        target_clip_max_sec=60,
        target_clip_ideal_sec=35,
        candidate_overlap_sec=5,
        max_candidates=14,
        scoring_weights={
            "hook_strength": 1.45,
            "conflict_tension": 1.35,
            "novelty_interestingness": 1.15,
            "verbosity_penalty": -1.0,
        },
    ),
    PresetConfig(
        id="plugin_demo_hook",
        name="Plugin Demo Hook",
        description="Surface short demo moments where a tool, plugin, or workflow becomes obvious quickly.",
        silence_threshold_db=-38,
        minimum_silence_duration=0.35,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="shorts_clean",
        zoom_rule="No dynamic tracking; keep exports deterministic.",
        shorts_behavior="Prefer clips where the viewer understands the tool and payoff without extra context.",
        cta_preservation="Keep product names and concise usage claims.",
        planner_hint="Reward specific demos, before/after value, and crisp technical explanations.",
        target_clip_min_sec=25,
        target_clip_max_sec=80,
        target_clip_ideal_sec=45,
        candidate_overlap_sec=6,
        max_candidates=12,
        scoring_weights={
            "self_containedness": 1.3,
            "payoff_clarity": 1.35,
            "niche_relevance": 1.2,
            "verbosity_penalty": -0.9,
        },
    ),
    PresetConfig(
        id="local_ai_experiment",
        name="Local AI Experiment",
        description="Find experiment logs and local-AI lessons that feel useful to technical viewers.",
        silence_threshold_db=-39,
        minimum_silence_duration=0.4,
        filler_removal_aggressiveness="medium",
        cut_aggressiveness="balanced",
        caption_style="shorts_clean",
        zoom_rule="Use stable 9:16 export framing without speculative tracking.",
        shorts_behavior="Rank practical local-first AI discoveries, caveats, and surprising results.",
        cta_preservation="Preserve setup only when it makes the experiment understandable.",
        planner_hint="Favor local model, toolchain, hardware, and developer workflow moments with clear lessons.",
        target_clip_min_sec=30,
        target_clip_max_sec=90,
        target_clip_ideal_sec=55,
        candidate_overlap_sec=8,
        max_candidates=10,
        scoring_weights={
            "novelty_interestingness": 1.2,
            "niche_relevance": 1.3,
            "payoff_clarity": 1.2,
            "self_containedness": 1.1,
        },
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
