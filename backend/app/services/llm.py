from __future__ import annotations

from typing import Any

import httpx


def _endpoint(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/chat/completions"
    return f"{clean}/v1/chat/completions"


def _extract_content(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        text_parts = [part.get("text", "") for part in message if isinstance(part, dict)]
        return "\n".join(part for part in text_parts if part)
    return str(message)


def request_planner_completion(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: int,
) -> str:
    if not base_url:
        raise RuntimeError("LLM base URL is missing. Update Settings before generating shorts candidates.")
    if not model:
        raise RuntimeError("Planner model is missing. Update Settings before generating shorts candidates.")

    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.post(_endpoint(base_url), json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("Planner endpoint returned no choices.")

    content = choices[0].get("message", {}).get("content")
    text = _extract_content(content)
    if not text.strip():
        raise RuntimeError("Planner endpoint returned an empty response.")
    return text
