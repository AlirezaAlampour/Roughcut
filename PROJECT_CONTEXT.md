# Project Context

## Product Purpose

Roughcut is a local-first app for AI-assisted YouTube rough-cut editing.

It is meant to remove repetitive edit labor:
- upload raw media
- transcribe it
- plan a first-pass cut with a local LLM
- execute that cut deterministically
- preview and download the results

It is not intended to become a full nonlinear editor.

## Core Architecture

Runtime services:
- `frontend`: Next.js browser UI
- `backend`: FastAPI REST API
- `worker`: background polling worker using the same Python app image

Persistence:
- SQLite for metadata/state
- bind-mounted project storage under `data/`
- named cache volume for model downloads

Planner:
- external OpenAI-compatible chat endpoint
- currently known-good with Ollama on the host

Executor:
- deterministic Python + ffmpeg

## Main Runtime Flow

1. Project is created in SQLite.
2. Uploads land in `data/projects/<project-id>/uploads/`.
3. Backend probes media with `ffprobe`.
4. User creates a rough-cut job.
5. Worker claims the job from SQLite.
6. Worker transcribes the media with `faster-whisper`.
7. Worker builds a planner prompt and calls the local model.
8. Planner returns JSON.
9. Backend validates JSON against the `EditPlan` schema.
10. Worker renders keep-ranges with `ffmpeg`.
11. Outputs are written to `outputs/<job-id>/`.
12. Job state and project manifest are updated.
13. Frontend polls and surfaces job progress + outputs.

## Key Modules

Backend:
- `backend/app/main.py`
  FastAPI app setup and router registration
- `backend/app/worker.py`
  polling worker loop
- `backend/app/services/jobs.py`
  orchestration for the full pipeline
- `backend/app/services/planner.py`
  planner prompt creation, JSON extraction, edit-plan normalization
- `backend/app/services/llm.py`
  OpenAI-compatible chat request path normalization
- `backend/app/services/media.py`
  ffprobe helpers, transcript/srt writing, ffmpeg render logic
- `backend/app/services/transcription.py`
  `faster-whisper` integration
- `backend/app/services/storage.py`
  project paths, manifest syncing, safe file handling
- `backend/app/services/repository.py`
  SQLite CRUD and serialization of rows into API/job objects
- `backend/app/utils/serialization.py`
  JSON-safe normalization for Pydantic models and other non-native types

Frontend:
- `frontend/src/app/page.tsx`
  projects page
- `frontend/src/app/projects/[projectId]/page.tsx`
  main project workspace
- `frontend/src/app/settings/page.tsx`
  settings page
- `frontend/src/lib/api.ts`
  frontend REST client

## Important Invariants

- The LLM is planner-only.
- The LLM must never directly execute shell, ffmpeg, or filesystem operations.
- Planner output must validate against `EditPlan` before execution.
- File access must stay inside project directories.
- Roughcut is intentionally local-first and single-user in v1.
- Keep the architecture small: SQLite + worker loop is enough here.

## Current Working Planner Configuration

Known-good Ollama setup:
- base URL: `http://host.docker.internal:11434/v1`
- model: `qwen3:32b`

Why that matters:
- Compose maps `host.docker.internal` to the Docker host gateway
- `backend/app/services/llm.py` expects an OpenAI-compatible base URL and normalizes to `/v1/chat/completions`

If you point the app at non-OpenAI Ollama endpoints, planning will fail.

## Why Planner-Only Matters

This project deliberately separates:
- planning
- execution

Planning:
- summarization
- range selection
- caption strategy
- notes for user

Execution:
- transcript persistence
- file writes
- ffmpeg filters and render
- subtitle export
- job state transitions

That boundary keeps the system predictable, debuggable, and safer than a free-form “agent edits your machine” design.

## What Not To Overengineer

- do not add Redis/Celery/Kafka
- do not add microservices
- do not add a websocket stack unless polling clearly becomes a problem
- do not turn the UI into a full NLE
- do not add cloud sync or cloud storage to v1
- do not add complex auth unless there is a clear deployment reason

The value of this repo is the narrow workflow, not architectural novelty.

## Current Technical Debt / Next Improvements

- long transcript planning is still single-shot
- active job cancellation is incomplete
- transcription defaults to CPU, not a DGX-tuned GPU path
- inline preview for text artifacts is still minimal
- no resumable uploads
- no auth
- npm advisories and a non-blocking Next font warning still exist

## Real Debugging History And Lessons Learned

### Planner endpoint mismatch

Lesson:
- the app must target an OpenAI-compatible chat endpoint, not arbitrary Ollama routes

### Docker host access blocked by UFW

Lesson:
- `host.docker.internal` is not enough if host firewall rules block traffic from Docker bridge subnets to Ollama port `11434`

### JSON serialization boundary bugs

Lesson:
- `JobResult` and other structured runtime objects cannot cross raw `json.dumps(...)` boundaries
- JSON file writers now use `make_json_safe()` before dumping

### Patched source vs stale running image

Lesson:
- when behavior and source disagree, suspect an old container image before assuming the patch failed

### First-run whisper warnings

Lesson:
- cold cache transcription runs may log Hugging Face/model download noise that is not an application logic bug

## Guidance For Future Work

- preserve the local-first appliance model
- keep browser-based file management central
- prefer explicit code over abstractions
- treat DGX Spark / ARM64 friendliness as a first-class constraint
- keep changes small, testable, and deterministic
