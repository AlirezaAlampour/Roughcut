# Roughcut Backend

FastAPI and worker services for Roughcut's local-first shorts candidate pipeline.

The backend keeps the small v1 architecture:

- FastAPI REST API
- SQLite project/file/job/settings state
- polling worker, no queue broker
- faster-whisper transcription
- planner-only LLM calls with OpenAI-compatible and Ollama-native endpoint support
- deterministic ffmpeg rendering for selected candidates
- per-job `trace.jsonl` activity logs plus planner prompt/response and render command artifacts

For Dockerized Mac setups, point `VIDEO_AGENT_DEFAULT_LLM_BASE_URL` at `http://host.docker.internal:11434` or an equivalent `/v1` base URL. Roughcut will probe both route families and keep the planner boundary unchanged.
