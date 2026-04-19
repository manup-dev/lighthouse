from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable, Protocol

import httpx

# Anthropic pricing as of April 2026 ($ per 1M tokens). Update as rates move.
# Keys match what make_llm() sets as `.model` on AnthropicLLM.
ANTHROPIC_PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {"in": 3.0, "out": 15.0},
    "claude-haiku-4-5-20251001": {"in": 1.0, "out": 5.0},
    "claude-opus-4-7": {"in": 15.0, "out": 75.0},
}
_FALLBACK_PRICING = {"in": 3.0, "out": 15.0}  # use Sonnet as the "assume expensive" default


def _compute_cost(model: str, usage: dict[str, int]) -> float:
    """Return USD cost for an Anthropic call given its reported usage.

    Unknown models fall back to Sonnet pricing so the budget cap still trips —
    silently treating an unknown model as free would bypass the whole guard."""
    p = ANTHROPIC_PRICING.get(model, _FALLBACK_PRICING)
    cents = (
        usage.get("input_tokens", 0) * p["in"]
        + usage.get("output_tokens", 0) * p["out"]
    )
    return cents / 1_000_000


class BudgetExhausted(Exception):
    """Raised when spend would exceed the configured cap. Not currently
    raised — we prefer silent fallback to Ollama so the demo keeps working."""

# 3B is the safe default — it's the only Qwen size we've measured running
# usably fast (~13 tok/s) on CPU-only boxes and on GPU boxes whose driver is
# healthy. Override via OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M (better
# quality, ~2x slower on CPU) or qwen2.5:14b-instruct-q4_K_M (best quality,
# needs the 5070Ti to be live) when you've got headroom.
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
                # Context + output cap sized for the 3B CPU default. 4k is
                # enough for every stage except the ranker if the candidate
                # pool is very wide. On GPU bump via env vars:
                #   OLLAMA_NUM_CTX=16384 OLLAMA_NUM_PREDICT=2048
                "num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "4096")),
                "num_predict": int(os.environ.get("OLLAMA_NUM_PREDICT", "1024")),
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
        # Expose the real token counts so BudgetedLLM can charge against cap.
        usage = getattr(resp, "usage", None)
        self.last_usage = {
            "input_tokens": getattr(usage, "input_tokens", 0) or 0,
            "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        }
        return resp.content[0].text


class BudgetedLLM:
    """Wrap a primary (usually Anthropic) with a spend cap, falling back to a
    secondary (usually local Ollama) when the cap is hit or the primary fails.

    Spend is persisted to `spend_path` so the cap survives API restarts. Each
    call's cost is computed from the real token counts returned by Anthropic
    (via primary.last_usage), so the cap reflects actual billing, not an
    estimate."""

    def __init__(
        self,
        primary: "LLM",
        fallback: "LLM",
        budget_usd: float,
        spend_path: str | Path,
        on_log: Callable[[str], None] | None = None,
    ):
        self._primary = primary
        self._fallback = fallback
        self._budget = float(budget_usd)
        self._spend_path = Path(spend_path)
        self._on_log = on_log
        self.provider = (
            f"budgeted({getattr(primary, 'provider', '?')}→{getattr(fallback, 'provider', '?')})"
        )
        self.model = getattr(primary, "model", "?")

    def spent(self) -> float:
        try:
            raw = self._spend_path.read_text(encoding="utf-8").strip()
        except OSError:
            return 0.0
        if not raw:
            return 0.0
        # Prefer JSON (what we write), but accept a plain float too for hand-
        # edited files or seeded test fixtures.
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:
                return float(raw)
            except ValueError:
                return 0.0
        if isinstance(data, (int, float)):
            return float(data)
        if isinstance(data, dict):
            try:
                return float(data.get("spent_usd", 0.0))
            except (TypeError, ValueError):
                return 0.0
        return 0.0

    def _record(self, cost: float) -> float:
        total = self.spent() + cost
        try:
            self._spend_path.parent.mkdir(parents=True, exist_ok=True)
            self._spend_path.write_text(
                json.dumps({"spent_usd": total, "budget_usd": self._budget}),
                encoding="utf-8",
            )
        except OSError:
            pass
        return total

    def _log(self, msg: str) -> None:
        if self._on_log:
            try:
                self._on_log(msg)
            except Exception:  # noqa: BLE001 — logs must never break LLM calls
                pass

    def __call__(self, system: str, user: str) -> str:
        if self.spent() >= self._budget:
            self._log(
                f"$ budget exhausted (${self.spent():.2f}/${self._budget:.2f}) — using local LLM"
            )
            return self._fallback(system, user)
        try:
            text = self._primary(system, user)
        except Exception as exc:  # noqa: BLE001 — any failure → fall back silently
            self._log(f"$ primary LLM failed ({exc}) — using local LLM")
            return self._fallback(system, user)
        usage = getattr(self._primary, "last_usage", None)
        if usage:
            cost = _compute_cost(getattr(self._primary, "model", ""), usage)
            total = self._record(cost)
            self._log(
                f"$ anthropic call: ${cost:.4f} "
                f"(total ${total:.2f} / cap ${self._budget:.2f})"
            )
        return text


def make_llm(provider: str | None = None) -> LLM:
    """Build the configured LLM.

    Providers:
      - `ollama` (default): local Qwen via Ollama.
      - `anthropic`: cloud Claude. If LIGHTHOUSE_ANTHROPIC_BUDGET_USD is set,
        automatically wraps in a BudgetedLLM that falls back to Ollama once
        spend reaches the cap — so a demo can't silently drain your key.
      - `budgeted`: explicit opt-in to the same behaviour (uses Anthropic
        primary + Ollama fallback).
    """
    provider = provider or os.environ.get("LIGHTHOUSE_LLM", "ollama")

    def _ollama() -> OllamaLLM:
        return OllamaLLM(
            model=os.environ.get("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
            base_url=os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_URL),
        )

    def _anthropic() -> AnthropicLLM:
        return AnthropicLLM(
            model=os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        )

    if provider == "ollama":
        return _ollama()
    if provider == "anthropic":
        budget = os.environ.get("LIGHTHOUSE_ANTHROPIC_BUDGET_USD")
        if budget:
            return BudgetedLLM(
                primary=_anthropic(),
                fallback=_ollama(),
                budget_usd=float(budget),
                spend_path=os.environ.get(
                    "LIGHTHOUSE_SPEND_FILE",
                    "/tmp/lighthouse-anthropic-spend.json",
                ),
            )
        return _anthropic()
    if provider == "budgeted":
        return BudgetedLLM(
            primary=_anthropic(),
            fallback=_ollama(),
            budget_usd=float(os.environ.get("LIGHTHOUSE_ANTHROPIC_BUDGET_USD", "5.0")),
            spend_path=os.environ.get(
                "LIGHTHOUSE_SPEND_FILE", "/tmp/lighthouse-anthropic-spend.json"
            ),
        )
    raise ValueError(
        f"unknown LLM provider: {provider!r} (expected 'ollama', 'anthropic', or 'budgeted')"
    )
