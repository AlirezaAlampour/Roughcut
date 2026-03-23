# Project Tree

## Top Level

```text
Roughcut/
├─ backend/
├─ config/
├─ frontend/
├─ compose.yaml
├─ .env.example
├─ PROJECT_CONTEXT.md
├─ PROJECT_TREE.md
├─ AGENTS.md
└─ README.md
```

## Top-Level Roles

- `backend/`
  Python/FastAPI application and worker runtime
- `frontend/`
  Next.js browser app
- `config/`
  example preset override file
- `compose.yaml`
  local multi-container entry point
- `.env.example`
  runtime configuration template

## Backend

```text
backend/
├─ Dockerfile
├─ pyproject.toml
├─ tests/
│  └─ test_manifest_serialization.py
└─ app/
   ├─ main.py
   ├─ worker.py
   ├─ config.py
   ├─ db.py
   ├─ schemas.py
   ├─ routers/
   ├─ services/
   └─ utils/
```

Important backend files:

- `backend/app/main.py`
  FastAPI app setup, CORS, router registration
- `backend/app/worker.py`
  infinite polling loop that calls `jobs.process_next_job`
- `backend/app/config.py`
  settings model and env-backed config
- `backend/app/db.py`
  SQLite schema and connection helpers
- `backend/app/schemas.py`
  API models, transcript models, `EditPlan`, `JobResult`

### Routers

- `backend/app/routers/health.py`
  health check
- `backend/app/routers/projects.py`
  project CRUD, uploads, file actions, job creation/listing
- `backend/app/routers/jobs.py`
  job status and cancel route
- `backend/app/routers/settings.py`
  settings read/update
- `backend/app/routers/presets.py`
  preset listing
- `backend/app/routers/downloads.py`
  browser download path for stored files

### Services

- `backend/app/services/jobs.py`
  main job orchestration flow, output writing, status transitions
- `backend/app/services/planner.py`
  planner prompt construction, JSON extraction, edit-plan normalization
- `backend/app/services/llm.py`
  OpenAI-compatible chat request helper
- `backend/app/services/media.py`
  ffprobe helpers, transcript text, srt generation, ffmpeg render
- `backend/app/services/transcription.py`
  `faster-whisper` wrapper
- `backend/app/services/repository.py`
  SQLite CRUD and row serialization
- `backend/app/services/storage.py`
  project paths, filename safety, manifest syncing
- `backend/app/services/presets.py`
  built-in presets + optional file override merge

### Utils

- `backend/app/utils/serialization.py`
  JSON-safe normalization for Pydantic models, dataclasses, `Path`, `datetime`, `Enum`, and nested containers

### Tests

- `backend/tests/test_manifest_serialization.py`
  regression coverage for JSON-safe file writing and project manifest sync

## Frontend

```text
frontend/
├─ Dockerfile
├─ package.json
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
└─ src/
   ├─ app/
   ├─ components/
   └─ lib/
```

Important frontend files:

- `frontend/src/app/layout.tsx`
  root layout and shell wrapper
- `frontend/src/app/page.tsx`
  projects page
- `frontend/src/app/projects/[projectId]/page.tsx`
  main project workspace
- `frontend/src/app/settings/page.tsx`
  settings page

### Frontend Components

- `frontend/src/components/layout/`
  app shell and page header
- `frontend/src/components/project/`
  upload area, file list, preview, generate panel, job feed
- `frontend/src/components/projects/`
  project cards
- `frontend/src/components/settings/`
  settings form
- `frontend/src/components/ui/`
  local shadcn-style primitives

### Frontend Lib

- `frontend/src/lib/api.ts`
  client-side REST wrapper
- `frontend/src/lib/types.ts`
  frontend TypeScript types
- `frontend/src/lib/format.ts`
  formatting helpers
- `frontend/src/lib/utils.ts`
  utility helpers like `cn`

## Config And Runtime Data

- `config/presets.example.json`
  example preset override file for `data/config/presets.json`

Runtime data is not meant for git:

```text
data/
├─ app.db
├─ config/
├─ logs/
└─ projects/
```

## Where To Look

Planner logic:
- `backend/app/services/planner.py`
- `backend/app/services/llm.py`

Job processing:
- `backend/app/services/jobs.py`
- `backend/app/worker.py`

Storage:
- `backend/app/services/storage.py`
- `backend/app/services/repository.py`

Serialization:
- `backend/app/utils/serialization.py`
- `backend/app/services/storage.py`
- `backend/app/services/jobs.py`

Tests:
- `backend/tests/test_manifest_serialization.py`

Docker config:
- `compose.yaml`
- `backend/Dockerfile`
- `frontend/Dockerfile`

Presets and settings:
- `backend/app/services/presets.py`
- `backend/app/routers/settings.py`
- `backend/app/routers/presets.py`
- `.env.example`
