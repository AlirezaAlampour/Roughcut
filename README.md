# Roughcut

Roughcut is a local-first AI-assisted shorts candidate generator.

It is built for a single-user DGX Spark style setup:

- browser UI on your main PC
- media files stored on the local machine running the stack
- faster-whisper transcription in the worker
- a local OpenAI-compatible or Ollama-native planner model
- deterministic ffmpeg execution inside Docker containers

Roughcut keeps its name, but the product focus is now source-to-shorts review:

1. upload one long-form source video or audio file
2. transcribe it locally
3. split the transcript into practical candidate windows
4. ask the planner to score and rank those windows
5. review candidate cards in the UI
6. export selected candidates as vertical MP4 shorts with captions

## What Roughcut Is

- a project-based browser app for local media review
- a shorts candidate generator for one user
- a deterministic transcription, segmentation, scoring, and export pipeline
- a small FastAPI + Next.js + worker + SQLite app
- a local appliance-style tool that stays on your machine and trusted network

## What Roughcut Is Not

- not a full nonlinear editor
- not a timeline UI
- not a cloud app
- not a posting scheduler
- not a general machine-control agent
- not a Redis/Celery/Kafka system
- not a collaborative editing platform

## Current Architecture

Roughcut runs as three Docker Compose services:

- `frontend`
  Next.js app on port `3000`
- `backend`
  FastAPI REST API on port `8000`
- `worker`
  lightweight polling worker that reads queued jobs from SQLite

Shared runtime pieces:

- SQLite for project/file/job/settings state
- bind-mounted project storage under `./data`
- named model cache volume at `/root/.cache`
- host LLM access via `host.docker.internal:host-gateway`

The planner is planner-only. It returns strict JSON metadata. It never gets direct shell, filesystem, or ffmpeg control.

## Pipeline

The main v1 job is `shorts_candidate_generation`.

1. The browser uploads source media to `/api/projects/{id}/uploads`.
2. The backend stores the upload under `data/projects/<project-id>/uploads/`.
3. `ffprobe` extracts duration and stream metadata.
4. A shorts candidate generation job is queued in SQLite.
5. The worker transcribes the source with faster-whisper.
6. Transcript artifacts are written as JSON and text.
7. Deterministic code pre-segments transcript windows using sentence boundaries, pause boundaries, duration targets, and overlap suppression.
8. The planner scores each candidate with strict JSON.
9. Roughcut writes `candidates.json` and job metadata.
10. The UI displays ranked candidates with score, timing, hook, rationale, tags, and transcript excerpt.
11. The user exports selected candidates.
12. A `short_export` job renders a deterministic vertical short with ffmpeg.

## Candidate Scoring

Each candidate is scored for:

- hook strength in the opening seconds
- self-containedness
- conflict/tension
- payoff clarity
- novelty / interestingness
- niche relevance for creator, AI, and technical content
- verbosity / rambling penalty
- overlap / duplication penalty

Planner output is validated with Pydantic before it is persisted or used by export jobs.

## Export Artifacts

Candidate generation jobs write:

```text
outputs/<job-id>/
├─ transcript.json
├─ transcript.txt
├─ candidates.json
└─ job.log
```

Candidate export jobs write:

```text
outputs/<export-job-id>/<candidate-id>/
├─ clip.mp4
├─ captions.srt
├─ captions.vtt
├─ candidate.json
├─ thumbnail.jpg
└─ job.log
```

The MP4 export uses a simple 9:16 strategy:

- centered crop when the source aspect is suitable
- blurred background with centered foreground for narrow sources
- neutral vertical background for audio-only sources
- one clean burned-caption style when captions are enabled

There is no face tracking in v1.

## Presets

Built-in shorts presets:

- `tacdel_builder_story`
- `ai_brutal_truth`
- `plugin_demo_hook`
- `local_ai_experiment`

Presets influence:

- target clip duration
- max candidate count
- overlap tolerance
- planner scoring weights
- caption behavior
- export mode
- planner hint

You can override presets with:

```bash
mkdir -p data/config
cp config/presets.example.json data/config/presets.json
```

## Environment Variables

Main runtime variables in `.env.example`:

| Variable | Purpose | Recommended value |
| --- | --- | --- |
| `FRONTEND_PORT` | browser UI port | `3000` |
| `BACKEND_PORT` | FastAPI port | `8000` |
| `FRONTEND_BIND_HOST` | host interface for the published UI port | `0.0.0.0` |
| `BACKEND_BIND_HOST` | host interface for the published API port | `0.0.0.0` |
| `NEXT_PUBLIC_APP_TITLE` | UI title | `Roughcut` |
| `VIDEO_AGENT_DATABASE_PATH` | SQLite DB path in container | `/data/app.db` |
| `VIDEO_AGENT_STORAGE_ROOT` | project storage root in container | `/data/projects` |
| `VIDEO_AGENT_CONFIG_ROOT` | config root in container | `/data/config` |
| `VIDEO_AGENT_LOGS_ROOT` | logs root in container | `/data/logs` |
| `VIDEO_AGENT_DEFAULT_LLM_BASE_URL` | planner base URL | `http://host.docker.internal:11434` |
| `VIDEO_AGENT_DEFAULT_LLM_MODEL` | planner model name | `qwen3:32b` |
| `VIDEO_AGENT_DEFAULT_PRESET` | default shorts preset | `tacdel_builder_story` |
| `VIDEO_AGENT_DEFAULT_CUT_AGGRESSIVENESS` | default candidate density | `balanced` |
| `VIDEO_AGENT_DEFAULT_CAPTIONS_ENABLED` | burned captions default | `true` |
| `VIDEO_AGENT_DEFAULT_OUTPUT_QUALITY_PRESET` | ffmpeg quality preset | `balanced` |
| `VIDEO_AGENT_WHISPER_MODEL` | faster-whisper model size | `small` |
| `VIDEO_AGENT_WHISPER_DEVICE` | transcription device | `cpu` |
| `VIDEO_AGENT_WHISPER_COMPUTE_TYPE` | whisper compute type | `int8` |
| `VIDEO_AGENT_MAX_UPLOAD_SIZE_MB` | upload size limit | `8192` |
| `VIDEO_AGENT_WORKER_POLL_INTERVAL_SECONDS` | worker polling interval | `2` |
| `VIDEO_AGENT_LLM_REQUEST_TIMEOUT_SECONDS` | planner timeout | `180` |

## Dockerized Local and LAN Run

Prepare env:

```bash
cp .env.example .env
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

Open on the Mac Studio:

- UI: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

The default bind hosts are `0.0.0.0`, so Docker publishes the UI and API ports on all Mac host interfaces for trusted LAN use. To keep the stack local-only on the Mac, set these in `.env`:

```bash
FRONTEND_BIND_HOST=127.0.0.1
BACKEND_BIND_HOST=127.0.0.1
```

For a stricter LAN deployment check, set `FRONTEND_BIND_HOST` and `BACKEND_BIND_HOST` to the actual Mac LAN or Tailscale IP. Docker will then fail fast if another service already owns that exact IP and port.

### Mac Studio LAN Access

Find the Mac Studio LAN IP:

```bash
MAC_LAN_IFACE=$(route get default | awk '/interface:/{print $2}')
MAC_LAN_IP=$(ipconfig getifaddr "$MAC_LAN_IFACE")
echo "$MAC_LAN_IP"
```

From another machine on the same trusted LAN or Tailscale network, open:

- UI: `http://<MAC_LAN_IP>:3000`
- API docs: `http://<MAC_LAN_IP>:8000/docs`

If you changed `FRONTEND_PORT` or `BACKEND_PORT` in `.env`, use those ports instead.

macOS Firewall may need to allow Docker Desktop or incoming connections for the published ports. Roughcut has no auth layer and is intended for a trusted LAN or private network such as Tailscale, not direct public internet exposure.

### Deployment Verification Checklist

```bash
docker compose up --build -d
docker compose ps
curl http://localhost:8000/api/health
curl http://<MAC_LAN_IP>:8000/api/health
```

Then open `http://<MAC_LAN_IP>:3000` from another machine on the same network.

If the LAN URL opens a different app, another container or process may already be bound to that specific LAN IP and port. Check:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Stop the conflicting service or change `FRONTEND_PORT` / `BACKEND_PORT` in `.env`, then rerun `docker compose up -d`.

The frontend calls relative `/api` and `/downloads` paths, and Next.js rewrites those requests to `http://backend:8000` inside the Docker network. This keeps browser access LAN-friendly while preserving simple frontend-to-backend container networking.

## Planner Configuration

Roughcut supports either:

- an OpenAI-compatible chat endpoint
- an Ollama-native endpoint

Recommended local Mac/Docker setup:

- base URL: `http://host.docker.internal:11434`
- model: `qwen3:32b`

You can still use a base URL that already ends in `/v1`. Roughcut normalizes the configured value and probes the local runtime in this order:

- `GET /v1/models`
- `GET /api/tags` if the OpenAI-compatible probe is missing or unavailable

Planner requests then use:

- `POST /v1/chat/completions` for OpenAI-compatible runtimes
- `POST /api/chat` for Ollama-native runtimes

Important:

- `host.docker.internal` lets the backend and worker containers reach a model runtime running on the Mac host
- do not point Roughcut at Ollama's legacy `/api/generate` route
- if Docker cannot reach the host runtime, check macOS firewall rules and Docker-to-host access first

## Migration Notes

This pivot does not add a database migration. Existing SQLite tables still store projects, files, jobs, settings, and JSON job results.

New jobs use:

- `shorts_candidate_generation`
- `short_export`

Old completed job records can remain in existing local data, but the active product flow is candidates plus selected exports.

## Known v2 Gaps

- no face tracking or speaker-aware reframing
- no transcript chunking for extremely long videos yet
- no resumable uploads
- no active running-job cancellation
- no posting or scheduler integrations
- no auth layer; keep deployments on a trusted LAN or private network
