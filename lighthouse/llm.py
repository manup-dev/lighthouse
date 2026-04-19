from __future__ import annotations

import os
from typing import Any, Callable, Protocol

import httpx

DEFAULT_OLLAMA_MODEL = "qwen2.5:14b-instruct-q4_K_M"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 4096


class LLM(Protocol):
    def __call__(self, system: str, user: str) -> str: ...


class OllamaLLM:
    def __init__(
        self,
        model: str = DEFAULT_OLLAMA_MODEL,
        base_url: str = DEFAULT_OLLAMA_URL,
        temperature: float = DEFAULT_TEMPERATURE,
        timeout: float = 180.0,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.temperature = temperature
        self.timeout = timeout

    def __call__(self, system: str, user: str) -> str:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {"temperature": self.temperature},
        }
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(f"{self.base_url}/api/chat", json=body)
            resp.raise_for_status()
            return resp.json()["message"]["content"]


class AnthropicLLM:
    def __init__(
        self,
        model: str = DEFAULT_ANTHROPIC_MODEL,
        api_key: str | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        client: Any | None = None,
    ):
        if client is None:
            import anthropic

            client = anthropic.Anthropic(
                api_key=api_key or os.environ.get("ANTHROPIC_API_KEY")
            )
        self._client = client
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens

    def __call__(self, system: str, user: str) -> str:
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return resp.content[0].text


def make_llm(provider: str | None = None) -> LLM:
    provider = provider or os.environ.get("LIGHTHOUSE_LLM", "ollama")
    if provider == "ollama":
        return OllamaLLM(
            model=os.environ.get("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
            base_url=os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_URL),
        )
    if provider == "anthropic":
        return AnthropicLLM(
            model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        )
    raise ValueError(f"unknown LLM provider: {provider!r} (expected 'ollama' or 'anthropic')")
