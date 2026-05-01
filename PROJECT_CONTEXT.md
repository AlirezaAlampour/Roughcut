# Project Context

## Product Purpose

Roughcut is a local-first app for AI-assisted shorts candidate generation.

The v1 workflow is:

- upload one long-form source video or audio file
- transcribe it locally with faster-whisper
- pre-segment the transcript into candidate windows
- score and rank candidates with a planner-only LLM
- review candidates in the browser
- export selected candidates as vertical shorts with captions

Roughcut is not intended to become a full nonlinear editor, timeline UI, cloud workflow, or publishing scheduler.

## Core Architecture

Runtime services:

- `frontend`: Next.js browser UI
- `backend`: FastAPI REST API
- `worker`: background polling worker using the same Python app image

Persistence:

- SQLite for project/file/job/settings state
- bind-mounted project storage under `data/`
- named cache volume for model downloads

Planner:

- external OpenAI-compatible chat endpoint
- planner-only JSON output
- Pydantic validation before persistence or export

Executor:

- deterministic Python + ffmpeg
- no LLM shell control
- no Redis/Celery/Kafka

## Main Runtime Flow

1. Project is created in SQLite.
2. Uploads land in `data/projects/<project-id>/uploads/`.
3. Backend probes media with `ffprobe`.
4. User creates a `shorts_candidate_generation` job.
5. Worker claims the job from SQLite.
6. Worker transcribes the source with `faster-whisper`.
7. Worker writes transcript artifacts.
8. Deterministic code creates candidate windows using sentence/pause boundaries, duration targets, and overlap limits.
9. Worker asks the planner to score the candidate windows.
10. Planner returns strict JSON matching the candidate scoring schema.
11. Worker writes `candidates.json` and completes the job.
12. Frontend polls and displays ranked candidates.
13. User exports a selected candidate.
14. Worker runs a `short_export` job and writes MP4, captions, metadata, thumbnail, and log artifacts.

## Key Modules

Backend:

- `backend/app/main.py`
  FastAPI app setup and router registration
- `backend/app/worker.py`
  polling worker loop
- `backend/app/services/jobs.py`
  orchestration for candidate generation and candidate export jobs
- `backend/app/services/candidates.py`
  deterministic transcript pre-segmentation
- `backend/app/services/planner.py`
  planner prompt creation, strict JSON extraction, candidate score validation
- `backend/app/services/llm.py`
  OpenAI-compatible chat request path normalization
- `backend/app/services/media.py`
  ffprobe helpers, transcript/subtitle writing, vertical short rendering
- `backend/app/services/transcription.py`
  `faster-whisper` integration
- `backend/app/services/storage.py`
  project paths, manifest syncing, safe file handling
- `backend/app/services/repository.py`
  SQLite CRUD and row serialization
- `backend/app/utils/serialization.py`
  JSON-safe normalization for Pydantic models and other non-native types

Frontend:

- `frontend/src/app/page.tsx`
  projects page
- `frontend/src/app/projects/[projectId]/page.tsx`
  project workspace
- `frontend/src/components/project/generate-panel.tsx`
  shorts candidate generation controls
- `frontend/src/components/project/candidate-list.tsx`
  ranked candidate review and export actions
- `frontend/src/components/project/job-feed.tsx`
  job progress and output access
- `frontend/src/lib/api.ts`
  frontend REST client

## Important Invariants

- Roughcut is local-first and single-user.
- The LLM is planner-only.
- Planner output must be strict JSON and schema-validated.
- Media execution is deterministic Python + ffmpeg.
- File access must stay inside project directories.
- SQLite + worker polling is enough for v1.
- The UI is review-oriented, not timeline-oriented.

## Current Planner Configuration

Known-good Ollama setup:

- base URL: `http://host.docker.internal:11434/v1`
- model: `qwen3:32b`

The backend expects an OpenAI-compatible base URL and normalizes it to `/v1/chat/completions`.

## What Not To Overengineer

- no timeline editor
- no drag-and-drop clip rearrangement
- no distributed queues
- no microservices
- no websocket stack unless polling becomes a real problem
- no cloud sync or cloud storage
- no posting or scheduler integrations
- no auth unless deployment requirements change

## Current Technical Debt / Next Improvements

- long transcript planning is still single-shot
- active job cancellation is incomplete
- transcription defaults to CPU
- no face tracking or speaker-aware crop
- no resumable uploads
- npm advisories and a non-blocking Next font warning may still exist

## Debugging Notes

Planner endpoint mismatch:

- use an OpenAI-compatible chat endpoint
- do not point settings at non-chat Ollama routes

Docker host access:

- `host.docker.internal` must resolve to the host gateway
- host firewalls can still block Docker bridge access to Ollama port `11434`

Serialization:

- job results, candidate manifests, and Pydantic models must pass through `make_json_safe()` before raw JSON writes
