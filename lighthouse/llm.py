from __future__ import annotations

import os
from typing import Any, Callable, Protocol

import httpx

# Default to the 3B model: measured 13 tok/s on this CPU (vs 8 for 7B, 4 for
# 14B). Full pipeline finishes in ~7 min per repo instead of ~15+, which is
# what makes a CPU-only hackathon demo usable. Quality is noticeably weaker on
# warm-intro drafts — override with OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M
# once the GPU comes back for higher-quality live runs.
DEFAULT_OLLAMA_MODEL = "qwen2.5:3b-instruct-q4_K_M"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 4096


class LLM(Protocol):
    def __call__(self, system: str, user: str) -> str: ...


class OllamaLLM:
    provider = "ollama"

    def __init__(
        self,
        model: str = DEFAULT_OLLAMA_MODEL,
        base_url: str = DEFAULT_OLLAMA_URL,
        temperature: float = DEFAULT_TEMPERATURE,
        # 300s covers cold-start model loads (~20s) + large-context generations
        # where num_predict can go to 2048 tokens. 180s was too tight when a
        # second request stole the GPU during a long ranker call.
        timeout: float = 300.0,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.temperature = temperature
        self.timeout = timeout

    def __call__(self, system: str, user: str) -> str:
        # Ollama defaults `num_ctx` to 2048, which is too tight for the Ranker
        # stage where the prompt holds ~5 candidates × rich metadata plus a
        # long system prompt. Bumping the context prevents silently-empty
        # responses (the JSON parser saw "" and blew up the whole run).
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {
                "temperature": self.temperature,
                # Qwen2.5 14B supports up to 32k; 16k is enough for ranker
                # prompts (~25 candidates × rich metadata + long system prompt)
                # without exploding GPU memory on the 5070Ti.
                "num_ctx": 16384,
                # Ollama defaults num_predict to 128 on /api/chat in some
                # versions, which silently truncates ranker output to "". Pin
                # it high enough to emit 5 matches with full metadata.
                "num_predict": 2048,
            },
        }
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(f"{self.base_url}/api/chat", json=body)
            resp.raise_for_status()
            return resp.json()["message"]["content"]


class AnthropicLLM:
    provider = "anthropic"

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
