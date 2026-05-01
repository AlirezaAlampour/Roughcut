# Roughcut Backend

FastAPI and worker services for Roughcut's local-first shorts candidate pipeline.

The backend keeps the small v1 architecture:

- FastAPI REST API
- SQLite project/file/job/settings state
- polling worker, no queue broker
- faster-whisper transcription
- planner-only OpenAI-compatible LLM calls
- deterministic ffmpeg rendering for selected candidates
