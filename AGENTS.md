# Agent Notes

Future coding agents should preserve these project constraints:

- keep Roughcut local-first
- keep the architecture small
- do not turn v1 into a full nonlinear editor
- do not add queues, brokers, or microservices unless there is a real blocker
- keep browser-based project/file management central
- preserve DGX Spark / ARM64 friendliness
- assume planner is external and OpenAI-compatible
- keep the LLM planner-only
- keep media execution deterministic in Python + ffmpeg
- prefer explicit code over abstraction layers
- preserve the simple workflow: upload -> transcribe -> plan -> render -> preview/download

Avoid:
- timeline editing features
- cloud sync
- team features
- auth systems heavier than the deployment really needs
- “agent controls the machine” behavior

When debugging:
- check planner endpoint shape before blaming prompts
- check UFW / Docker-to-host access before blaming Ollama
- check running container images before assuming patched source is active
- check JSON serialization boundaries when file writes fail after successful processing
