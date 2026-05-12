from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest import mock

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import llm


def _response(method: str, url: str, status_code: int, payload: dict | None = None) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=payload,
        request=httpx.Request(method, url),
    )


class FakeHttpxClient:
    def __init__(self, responses: dict[tuple[str, str], httpx.Response | Exception], **_: object) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict | None]] = []

    def __enter__(self) -> FakeHttpxClient:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def get(self, url: str) -> httpx.Response:
        self.calls.append(("GET", url, None))
        outcome = self.responses[("GET", url)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def post(self, url: str, json: dict | None = None) -> httpx.Response:
        self.calls.append(("POST", url, json))
        outcome = self.responses[("POST", url)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class PlannerLlmTests(unittest.TestCase):
    def _run_request(self, responses: dict[tuple[str, str], httpx.Response | Exception], *, base_url: str) -> tuple[str, FakeHttpxClient]:
        fake_client = FakeHttpxClient(responses)
        with mock.patch("app.services.llm.httpx.Client", return_value=fake_client):
            result = llm.request_planner_completion(
                base_url=base_url,
                model="qwen3:32b",
                system_prompt="Return JSON.",
                user_prompt="Score this clip.",
                timeout_seconds=30,
            )
        return result, fake_client

    def test_openai_compatible_success_path_supports_v1_base_url(self) -> None:
        base_url = "http://host.docker.internal:11434/v1"
        responses = {
            ("GET", "http://host.docker.internal:11434/v1/models"): _response(
                "GET",
                "http://host.docker.internal:11434/v1/models",
                200,
                {"data": [{"id": "qwen3:32b"}]},
            ),
            ("POST", "http://host.docker.internal:11434/v1/chat/completions"): _response(
                "POST",
                "http://host.docker.internal:11434/v1/chat/completions",
                200,
                {"choices": [{"message": {"content": '{"answer":"openai"}'}}]},
            ),
        }

        result, fake_client = self._run_request(responses, base_url=base_url)

        self.assertEqual(result, '{"answer":"openai"}')
        self.assertEqual(
            fake_client.calls,
            [
                ("GET", "http://host.docker.internal:11434/v1/models", None),
                ("POST", "http://host.docker.internal:11434/v1/chat/completions", mock.ANY),
            ],
        )

    def test_ollama_fallback_after_openai_probe_404_supports_plain_host_base_url(self) -> None:
        base_url = "http://host.docker.internal:11434"
        responses = {
            ("GET", "http://host.docker.internal:11434/v1/models"): _response(
                "GET",
                "http://host.docker.internal:11434/v1/models",
                404,
                {"error": "not found"},
            ),
            ("GET", "http://host.docker.internal:11434/api/tags"): _response(
                "GET",
                "http://host.docker.internal:11434/api/tags",
                200,
                {"models": [{"name": "qwen3:32b"}]},
            ),
            ("POST", "http://host.docker.internal:11434/api/chat"): _response(
                "POST",
                "http://host.docker.internal:11434/api/chat",
                200,
                {"message": {"content": '{"answer":"ollama"}'}},
            ),
        }

        with self.assertLogs("app.services.llm", level="INFO") as logs:
            result, fake_client = self._run_request(responses, base_url=base_url)

        self.assertEqual(result, '{"answer":"ollama"}')
        self.assertIn("OpenAI-compatible route", "\n".join(logs.output))
        self.assertEqual(
            fake_client.calls,
            [
                ("GET", "http://host.docker.internal:11434/v1/models", None),
                ("GET", "http://host.docker.internal:11434/api/tags", None),
                ("POST", "http://host.docker.internal:11434/api/chat", mock.ANY),
            ],
        )

    def test_ollama_fallback_after_openai_chat_404(self) -> None:
        base_url = "http://host.docker.internal:11434/v1"
        responses = {
            ("GET", "http://host.docker.internal:11434/v1/models"): _response(
                "GET",
                "http://host.docker.internal:11434/v1/models",
                200,
                {"data": [{"id": "qwen3:32b"}]},
            ),
            ("POST", "http://host.docker.internal:11434/v1/chat/completions"): _response(
                "POST",
                "http://host.docker.internal:11434/v1/chat/completions",
                404,
                {"error": "not found"},
            ),
            ("GET", "http://host.docker.internal:11434/api/tags"): _response(
                "GET",
                "http://host.docker.internal:11434/api/tags",
                200,
                {"models": [{"name": "qwen3:32b"}]},
            ),
            ("POST", "http://host.docker.internal:11434/api/chat"): _response(
                "POST",
                "http://host.docker.internal:11434/api/chat",
                200,
                {"message": {"content": '{"answer":"fallback"}'}},
            ),
        }

        with self.assertLogs("app.services.llm", level="INFO") as logs:
            result, fake_client = self._run_request(responses, base_url=base_url)

        self.assertEqual(result, '{"answer":"fallback"}')
        self.assertIn("/v1/chat/completions", "\n".join(logs.output))
        self.assertEqual(
            fake_client.calls,
            [
                ("GET", "http://host.docker.internal:11434/v1/models", None),
                ("POST", "http://host.docker.internal:11434/v1/chat/completions", mock.ANY),
                ("GET", "http://host.docker.internal:11434/api/tags", None),
                ("POST", "http://host.docker.internal:11434/api/chat", mock.ANY),
            ],
        )

    def test_response_text_normalization_matches_for_openai_and_ollama(self) -> None:
        openai_text = llm._normalize_openai_response(
            {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "text", "text": '{"answer":"from-openai"}'},
                            ]
                        }
                    }
                ]
            }
        )
        ollama_text = llm._normalize_ollama_response(
            {
                "message": {
                    "content": '{"answer":"from-ollama"}',
                }
            }
        )

        self.assertEqual(openai_text, '{"answer":"from-openai"}')
        self.assertEqual(ollama_text, '{"answer":"from-ollama"}')

    def test_total_failure_returns_concise_diagnostic(self) -> None:
        base_url = "http://host.docker.internal:11434/v1"
        responses = {
            ("GET", "http://host.docker.internal:11434/v1/models"): _response(
                "GET",
                "http://host.docker.internal:11434/v1/models",
                404,
                {"error": "not found"},
            ),
            ("GET", "http://host.docker.internal:11434/api/tags"): _response(
                "GET",
                "http://host.docker.internal:11434/api/tags",
                404,
                {"error": "not found"},
            ),
        }

        fake_client = FakeHttpxClient(responses)
        with mock.patch("app.services.llm.httpx.Client", return_value=fake_client):
            with self.assertRaises(RuntimeError) as exc_info:
                llm.request_planner_completion(
                    base_url=base_url,
                    model="qwen3:32b",
                    system_prompt="Return JSON.",
                    user_prompt="Score this clip.",
                    timeout_seconds=30,
                )

        message = str(exc_info.exception)
        self.assertIn("Planner backend is unreachable or incompatible.", message)
        self.assertIn("OpenAI-compatible /v1/models returned 404", message)
        self.assertIn("Ollama-native /api/tags returned 404", message)


if __name__ == "__main__":
    unittest.main()
