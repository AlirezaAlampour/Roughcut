from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NormalizedEndpoints:
    original_base_url: str
    openai_base_url: str
    ollama_base_url: str

    @property
    def openai_models_url(self) -> str:
        return f"{self.openai_base_url}/models"

    @property
    def openai_chat_url(self) -> str:
        return f"{self.openai_base_url}/chat/completions"

    @property
    def ollama_tags_url(self) -> str:
        return f"{self.ollama_base_url}/api/tags"

    @property
    def ollama_chat_url(self) -> str:
        return f"{self.ollama_base_url}/api/chat"


@dataclass(frozen=True)
class RouteProbe:
    url: str
    status_code: int | None = None
    reason: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status_code is not None and 200 <= self.status_code < 300


def _join_base_and_suffix(base: str, suffix: str) -> str:
    return f"{base.rstrip('/')}{suffix}"


def _replace_path(base_url: str, path: str) -> str:
    parts = urlsplit(base_url)
    normalized_path = path or ""
    return urlunsplit((parts.scheme, parts.netloc, normalized_path, "", ""))


def _normalize_endpoints(base_url: str) -> NormalizedEndpoints:
    clean = base_url.strip().rstrip("/")
    parts = urlsplit(clean)
    clean_path = parts.path.rstrip("/")

    if clean_path.endswith("/v1/chat/completions"):
        root_path = clean_path[: -len("/v1/chat/completions")]
    elif clean_path.endswith("/chat/completions"):
        root_path = clean_path[: -len("/chat/completions")]
        if root_path.endswith("/v1"):
            root_path = root_path[: -len("/v1")]
    elif clean_path.endswith("/v1/models"):
        root_path = clean_path[: -len("/v1/models")]
    elif clean_path.endswith("/api/chat"):
        root_path = clean_path[: -len("/api/chat")]
    elif clean_path.endswith("/api/tags"):
        root_path = clean_path[: -len("/api/tags")]
    elif clean_path.endswith("/v1"):
        root_path = clean_path[: -len("/v1")]
    elif clean_path.endswith("/api"):
        root_path = clean_path[: -len("/api")]
    else:
        root_path = clean_path

    openai_base_path = _join_base_and_suffix(root_path, "/v1")
    ollama_base_path = root_path or ""
    return NormalizedEndpoints(
        original_base_url=clean,
        openai_base_url=_replace_path(clean, openai_base_path),
        ollama_base_url=_replace_path(clean, ollama_base_path),
    )


def _extract_content(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, dict):
        return str(message.get("text", ""))
    if isinstance(message, list):
        text_parts = [part.get("text", "") for part in message if isinstance(part, dict)]
        return "\n".join(part for part in text_parts if part)
    return str(message)


def _probe_route(client: httpx.Client, url: str) -> RouteProbe:
    try:
        response = client.get(url)
    except httpx.HTTPError as exc:
        return RouteProbe(url=url, error=str(exc))
    return RouteProbe(url=url, status_code=response.status_code, reason=response.reason_phrase)


def _describe_probe(label: str, probe: RouteProbe) -> str:
    if probe.ok:
        return f"{label} is reachable"
    if probe.status_code is not None:
        reason = f" {probe.reason}" if probe.reason else ""
        return f"{label} returned {probe.status_code}{reason}"
    return f"{label} failed: {probe.error or 'unknown error'}"


def _incompatible_backend_error(*, openai_probe: RouteProbe, ollama_probe: RouteProbe) -> RuntimeError:
    return RuntimeError(
        "Planner backend is unreachable or incompatible. "
        f"{_describe_probe('OpenAI-compatible /v1/models', openai_probe)}. "
        f"{_describe_probe('Ollama-native /api/tags', ollama_probe)}."
    )


def _normalize_openai_response(data: dict[str, Any]) -> str:
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("Planner endpoint returned no choices.")

    content = choices[0].get("message", {}).get("content")
    text = _extract_content(content)
    if not text.strip():
        raise RuntimeError("Planner endpoint returned an empty response.")
    return text


def _normalize_ollama_response(data: dict[str, Any]) -> str:
    message = data.get("message", {})
    content = message.get("content") if isinstance(message, dict) else data.get("response")
    text = _extract_content(content)
    if not text.strip():
        raise RuntimeError("Planner endpoint returned an empty response.")
    return text


def _request_openai_completion(
    client: httpx.Client,
    *,
    endpoints: NormalizedEndpoints,
    payload: dict[str, Any],
) -> str:
    try:
        response = client.post(endpoints.openai_chat_url, json=payload)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise
        raise RuntimeError(
            f"Planner request to OpenAI-compatible /v1/chat/completions failed ({exc.response.status_code} {exc.response.reason_phrase})."
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Planner request to OpenAI-compatible /v1/chat/completions failed: {exc}.") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("Planner backend returned invalid JSON from OpenAI-compatible /v1/chat/completions.") from exc
    return _normalize_openai_response(data)


def _request_ollama_completion(
    client: httpx.Client,
    *,
    endpoints: NormalizedEndpoints,
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> str:
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "options": {"temperature": 0.2},
    }

    try:
        response = client.post(endpoints.ollama_chat_url, json=payload)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Planner request to Ollama-native /api/chat failed ({exc.response.status_code} {exc.response.reason_phrase})."
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Planner request to Ollama-native /api/chat failed: {exc}.") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("Planner backend returned invalid JSON from Ollama-native /api/chat.") from exc
    return _normalize_ollama_response(data)


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

    endpoints = _normalize_endpoints(base_url)
    openai_payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        openai_probe = _probe_route(client, endpoints.openai_models_url)
        if openai_probe.ok:
            try:
                return _request_openai_completion(client, endpoints=endpoints, payload=openai_payload)
            except httpx.HTTPStatusError as exc:
                logger.info(
                    "OpenAI-compatible route %s was not found (404). Probing Ollama-native fallback.",
                    endpoints.openai_chat_url,
                )
                ollama_probe = _probe_route(client, endpoints.ollama_tags_url)
                if ollama_probe.ok:
                    return _request_ollama_completion(
                        client,
                        endpoints=endpoints,
                        model=model,
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                    )
                raise _incompatible_backend_error(
                    openai_probe=RouteProbe(
                        url=endpoints.openai_chat_url,
                        status_code=exc.response.status_code,
                        reason=exc.response.reason_phrase,
                    ),
                    ollama_probe=ollama_probe,
                ) from exc

        if openai_probe.status_code == 404:
            logger.info(
                "OpenAI-compatible route %s was not found (404). Probing Ollama-native fallback.",
                endpoints.openai_models_url,
            )

        ollama_probe = _probe_route(client, endpoints.ollama_tags_url)
        if ollama_probe.ok:
            return _request_ollama_completion(
                client,
                endpoints=endpoints,
                model=model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )

        raise _incompatible_backend_error(openai_probe=openai_probe, ollama_probe=ollama_probe)
