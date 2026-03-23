from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.config import Settings
from app.schemas import TranscriptArtifact, TranscriptSegment, WordTimestamp


@lru_cache(maxsize=4)
def _load_model(model_name: str, device: str, compute_type: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - dependency exists inside container
        raise RuntimeError("faster-whisper is not installed in the runtime environment.") from exc

    return WhisperModel(model_name, device=device, compute_type=compute_type)


def transcribe_media(settings: Settings, media_path: Path) -> TranscriptArtifact:
    model = _load_model(settings.whisper_model, settings.whisper_device, settings.whisper_compute_type)
    segments, info = model.transcribe(
        str(media_path),
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )

    normalized_segments: list[TranscriptSegment] = []
    for index, segment in enumerate(segments):
        words = [
            WordTimestamp(start=float(word.start), end=float(word.end), word=word.word)
            for word in (segment.words or [])
            if word.start is not None and word.end is not None and word.word
        ]
        normalized_segments.append(
            TranscriptSegment(
                index=index,
                start=float(segment.start),
                end=float(segment.end),
                text=segment.text.strip(),
                words=words,
            )
        )

    return TranscriptArtifact(
        language=getattr(info, "language", None),
        language_probability=getattr(info, "language_probability", None),
        segments=normalized_segments,
    )

