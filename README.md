# Roughcut

Roughcut is a local-first web app for AI-assisted YouTube rough-cut editing.

It is built for a single-user DGX Spark style setup:
- browser UI on your main PC
- media files stored on the DGX
- local planner model endpoint on the DGX host
- deterministic media execution inside Docker containers

The goal is simple: remove the repetitive editing work between raw upload and a usable first pass.

## What Roughcut Is

- a project-based browser app for uploading raw media
- a transcription + planning + render pipeline for rough cuts
- a local appliance-style tool that stays on your machine and local network
- a simple workflow for projects, files, jobs, previews, and downloads

## What Roughcut Is Not

- not a full nonlinear editor
- not a timeline UI
- not a cloud app
- not a general-purpose machine-control agent
- not a microservice platform
- not a collaborative editing system

## Product Goal

Roughcut is meant to kill the boring editing labor:
- upload raw video or audio
- transcribe it
- ask a local LLM for a structured edit plan
- validate that plan
- execute the actual edit deterministically with Python + ffmpeg
- preview and download the results

The product focus is browser-based project/file management and a clean rough-cut workflow, not replacing Premiere or CapCut.

## Current Architecture

Roughcut currently runs as three Docker Compose services:

- `frontend`
  Next.js app on port `3000`
- `backend`
  FastAPI REST API on port `8000`
- `worker`
  lightweight polling worker that reads queued jobs from SQLite and runs the pipeline

Shared runtime pieces:
- SQLite for project/file/job/settings state
- bind-mounted project storage under `./data`
- named volume for model cache at `/root/.cache`
- host LLM access via `host.docker.internal:host-gateway`

Key design rule:
- the LLM is planner-only
- media execution is deterministic code

The planner returns JSON. It never gets direct shell or ffmpeg control.

## Stack Summary

Frontend:
- Next.js 14
- TypeScript
- Tailwind CSS
- shadcn-style component layer
- lucide-react
- Sonner toasts

Backend:
- FastAPI
- Python 3.11+
- SQLite
- ffmpeg / ffprobe
- faster-whisper
- Pydantic models and schema validation
- simple worker loop instead of Redis/Celery

Infra:
- Docker Compose
- ARM64-friendly Python and Node base images
- bind-mounted local storage
- no Redis, no queue broker, no cloud dependency

## How the Pipeline Works

1. The browser uploads video/audio to `/api/projects/{id}/uploads`.
2. The backend saves files under the project `uploads/` directory.
3. `ffprobe` extracts metadata.
4. A job is created in SQLite with status `queued`.
5. The worker picks up the job.
6. `faster-whisper` transcribes the source and stores transcript artifacts.
7. The backend builds a planner prompt from transcript + preset + user notes.
8. The planner call goes through the OpenAI-compatible chat endpoint.
9. The planner output is parsed and validated against the `EditPlan` schema.
10. Deterministic code converts keep-ranges into an ffmpeg render.
11. Roughcut writes outputs and updates job state.
12. The frontend polls job status and exposes outputs for preview/download.

## Services and Docker Setup

Compose file: `compose.yaml`

Services:
- `frontend`
  - builds from `frontend/Dockerfile`
  - rewrites `/api/*` and `/downloads/*` to the backend container
- `backend`
  - builds from `backend/Dockerfile`
  - exposes `/api/health`, `/api/projects`, `/api/settings`, `/api/presets`, `/downloads/...`
  - mounts `./data:/data`
- `worker`
  - reuses the backend image
  - runs `python -m app.worker`
  - mounts the same `./data:/data`

The backend and worker both include:
- `extra_hosts: host.docker.internal:host-gateway`

That mapping is how containers reach Ollama on the DGX host.

## Environment Variables

Main runtime variables in `.env.example`:

| Variable | Purpose | Current recommended value |
| --- | --- | --- |
| `FRONTEND_PORT` | browser UI port | `3000` |
| `BACKEND_PORT` | FastAPI port | `8000` |
| `NEXT_PUBLIC_APP_TITLE` | UI title | `Roughcut` |
| `VIDEO_AGENT_DATABASE_PATH` | SQLite DB location in container | `/data/app.db` |
| `VIDEO_AGENT_STORAGE_ROOT` | project storage root in container | `/data/projects` |
| `VIDEO_AGENT_CONFIG_ROOT` | config root in container | `/data/config` |
| `VIDEO_AGENT_LOGS_ROOT` | logs root in container | `/data/logs` |
| `VIDEO_AGENT_DEFAULT_LLM_BASE_URL` | planner base URL | `http://host.docker.internal:11434/v1` |
| `VIDEO_AGENT_DEFAULT_LLM_MODEL` | planner model name | `qwen3:32b` |
| `VIDEO_AGENT_DEFAULT_PRESET` | default preset | `talking_head_clean` |
| `VIDEO_AGENT_DEFAULT_CUT_AGGRESSIVENESS` | default pacing | `balanced` |
| `VIDEO_AGENT_DEFAULT_CAPTIONS_ENABLED` | burned-in captions default | `true` |
| `VIDEO_AGENT_DEFAULT_OUTPUT_QUALITY_PRESET` | ffmpeg quality preset | `balanced` |
| `VIDEO_AGENT_WHISPER_MODEL` | whisper model size | `small` |
| `VIDEO_AGENT_WHISPER_DEVICE` | transcription device | `cpu` |
| `VIDEO_AGENT_WHISPER_COMPUTE_TYPE` | whisper compute type | `int8` |
| `VIDEO_AGENT_MAX_UPLOAD_SIZE_MB` | upload size limit | `8192` |
| `VIDEO_AGENT_WORKER_POLL_INTERVAL_SECONDS` | worker polling interval | `2` |
| `VIDEO_AGENT_LLM_REQUEST_TIMEOUT_SECONDS` | planner timeout | `180` |

## Planner Configuration

Roughcut expects an OpenAI-compatible chat endpoint.

The backend planner client:
- accepts a base URL
- normalizes it to `/v1/chat/completions` if needed
- sends `messages` with a system prompt and user prompt

Current known-good planner setup with Ollama:
- base URL: `http://host.docker.internal:11434/v1`
- model: `qwen3:32b`

This works because the backend container can reach the host via `host.docker.internal`, and Ollama exposes an OpenAI-compatible API on port `11434`.

Important:
- do not point Roughcut at Ollama’s non-OpenAI routes like `/api/generate`
- use the base URL, not the full `/chat/completions` URL
- Roughcut will append `/v1/chat/completions` if you give it `.../v1`

## DGX Spark Local Run

Recommended host path:

```bash
sudo mkdir -p /srv/video-agent
sudo chown -R "$USER":"$USER" /srv/video-agent
git clone https://github.com/AlirezaAlampour/Roughcut /srv/video-agent
cd /srv/video-agent
```

Prepare env:

```bash
cp .env.example .env
```

Optional preset override:

```bash
mkdir -p data/config
cp config/presets.example.json data/config/presets.json
```

Start the stack:

```bash
docker compose up --build -d
```

Useful commands:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend
docker compose down
```

## Access From Another Machine on LAN

From your main PC, open:

- UI: `http://<DGX-LAN-IP>:3000`
- API docs: `http://<DGX-LAN-IP>:8000/docs`

Notes:
- this is LAN-first software
- there is no auth layer in v1
- if you expose it beyond a trusted LAN/Tailscale network, add a gate first

## UFW / Ollama Host Access Note

If Ollama is running on the DGX host and Roughcut is running in Docker, the backend and worker must be able to reach host port `11434`.

Real failure mode:
- `host.docker.internal` resolves correctly
- but UFW blocks traffic from the Docker bridge subnet to host port `11434`
- planner calls fail even though Ollama works on the host itself

Check from the host:

```bash
curl http://127.0.0.1:11434/api/tags
```

If containers still cannot connect:
- inspect the Docker bridge subnet with `docker network inspect bridge`
- allow that subnet to reach TCP port `11434` in UFW
- then retry from the backend/worker containers

This is a host firewall issue, not a FastAPI or Ollama API issue.

## File and Project Structure

Top-level repo structure:

```text
Roughcut/
├─ backend/
├─ config/
├─ frontend/
├─ compose.yaml
├─ .env.example
├─ PROJECT_CONTEXT.md
├─ PROJECT_TREE.md
└─ README.md
```

Runtime data layout:

```text
data/
├─ app.db
├─ config/
│  └─ presets.json
├─ logs/
└─ projects/
   └─ <project-id>/
      ├─ uploads/
      ├─ outputs/
      │  └─ <job-id>/
      ├─ temp/
      └─ project.json
```

## Outputs Produced

For a completed rough-cut job, Roughcut currently writes:

- `rough-cut.mp4`
- `transcript.json`
- `transcript.txt`
- `captions.srt`
- `edit-plan.json`
- `job.log`

Job metadata is also stored in SQLite and mirrored into `project.json`.

## Current Implementation Notes

What exists now:
- project CRUD
- file upload/rename/delete/download
- media preview for playable files
- project detail workspace with uploads, outputs, preview, and generate panel
- settings screen
- presets loaded from built-in defaults and optional file override
- job queue with `queued`, `running`, `completed`, `failed`, `canceled`
- REST polling from frontend for job updates

What is intentionally still simple:
- no websocket layer
- no Redis/Celery
- no auth
- no cloud storage
- no resumable uploads
- no full timeline editing

## Known Limitations

- `faster-whisper` defaults to CPU in the current config for the safest ARM64 path.
- Planner integration assumes an OpenAI-compatible `/v1/chat/completions` API.
- Long transcripts are sent to the planner in one shot. There is no chunking or multi-pass planning yet.
- Inline preview is best for video/audio. Text artifacts are downloaded rather than richly previewed in the UI.
- Running jobs cannot be truly interrupted mid-transcription or mid-render yet. Only queued jobs can be canceled cleanly.
- Audio-only input renders to MP4 with a static visual background so it remains browser-friendly.
- There is still no auth or per-user isolation.
- The frontend build succeeds, but Next.js currently emits a non-blocking `Newsreader` font metric warning.
- Frontend dependencies still report an npm advisory and should be re-checked before wider exposure.

## Next Recommended Improvements

Keep them v2-small:

- add inline transcript / plan / log preview in the project workspace
- add transcript chunking or summarize-then-plan for longform projects
- add real in-flight job cancellation
- add optional GPU-tuned transcription profile for DGX Spark
- add clip export flow for `shorts_candidates`
- add optional `.vtt` export
- add a tiny LAN password gate if the app will be left running persistently

## Troubleshooting

### Host port conflicts

Symptom:
- `docker compose up` fails because `3000` or `8000` is already in use

Fix:
- change `FRONTEND_PORT` or `BACKEND_PORT` in `.env`
- restart with `docker compose up --build -d`

### Wrong planner endpoint

Symptom:
- planner requests fail immediately
- jobs reach transcription and then fail on planning

Cause:
- Roughcut expects an OpenAI-compatible chat endpoint
- pointing it at `/api/generate` or another non-chat Ollama path will fail

Known-good config:
- `VIDEO_AGENT_DEFAULT_LLM_BASE_URL=http://host.docker.internal:11434/v1`
- `VIDEO_AGENT_DEFAULT_LLM_MODEL=qwen3:32b`

### Docker container cannot reach host Ollama due to UFW

Symptom:
- Ollama works on the host
- planner calls fail from backend/worker containers

Cause:
- host firewall blocks Docker bridge subnet traffic to `11434`

Fix:
- verify Ollama locally on the host
- inspect the Docker bridge subnet
- allow that subnet to reach host TCP port `11434`

### Hugging Face warning during first whisper download

Symptom:
- first transcription run logs download warnings or slow model setup

Cause:
- the whisper model may be downloading into the shared model cache on first use

Notes:
- this is normal on cold start
- the Compose stack already mounts a persistent cache volume
- retry after the first model pull completes

### JobResult JSON serialization bug

Real issue that was fixed:
- completed jobs were sometimes failing after render
- render itself succeeded
- failure happened while writing JSON artifacts or `project.json`

Cause:
- `JobResult` Pydantic objects were crossing a raw `json.dumps(...)` boundary

Fix now in code:
- JSON file writes normalize through `app.utils.serialization.make_json_safe`
- this covers Pydantic models, dataclasses, `Path`, `datetime`/`date`, `Enum`, and nested containers

### Stale container image vs patched source mismatch

Symptom:
- code looks fixed in the repo
- but the running stack still behaves like the old version

Cause:
- containers were started from an older image

Fix:

```bash
docker compose build --no-cache backend worker frontend
docker compose up -d --force-recreate
```

If needed, confirm the running container image timestamps and container restart time.

## Verification Performed In This Workspace

- backend Docker build succeeded on ARM64
- frontend Docker build succeeded on ARM64
- `docker compose config` rendered successfully
- backend compile pass succeeded
- manifest / JSON serialization regression tests passed inside the backend runtime image

## Related Docs

- `PROJECT_CONTEXT.md`
- `PROJECT_TREE.md`
- `AGENTS.md`
