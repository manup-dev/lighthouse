"""Tests for BudgetedLLM — wraps Anthropic with a spend cap and falls back to
local Ollama once the cap is hit. Prevents a hackathon demo from silently
draining the user's API key."""

from __future__ import annotations

from pathlib import Path

import pytest

from lighthouse.llm import BudgetedLLM, _compute_cost, BudgetExhausted


class _FakePrimary:
    """Stands in for AnthropicLLM — lets a test dial token counts + throws."""

    provider = "anthropic"
    model = "claude-sonnet-4-6"

    def __init__(self, in_tokens: int = 1000, out_tokens: int = 500, raise_exc: Exception | None = None):
        self._in = in_tokens
        self._out = out_tokens
        self._raise = raise_exc
        self.calls = 0
        self.last_usage = None

    def __call__(self, system: str, user: str) -> str:
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        self.last_usage = {"input_tokens": self._in, "output_tokens": self._out}
        return "primary-ok"


class _FakeFallback:
    provider = "ollama"
    model = "qwen2.5:7b-instruct-q4_K_M"

    def __init__(self):
        self.calls = 0

    def __call__(self, system: str, user: str) -> str:
        self.calls += 1
        return "fallback-ok"


def test_under_budget_uses_primary_and_records_spend(tmp_path):
    primary = _FakePrimary(in_tokens=1_000_000, out_tokens=200_000)  # ~$3 + $3 = $6
    fallback = _FakeFallback()
    budget = BudgetedLLM(primary, fallback, budget_usd=5.0, spend_path=tmp_path / "spend.json")

    out = budget("sys", "user")

    # First call: primary is used, we were under budget at call-start.
    assert out == "primary-ok"
    assert primary.calls == 1
    assert fallback.calls == 0
    assert budget.spent() > 5.0  # now over budget after this call


def test_over_budget_uses_fallback(tmp_path):
    primary = _FakePrimary()
    fallback = _FakeFallback()
    # Pre-seed spend file past budget.
    (tmp_path / "spend.json").write_text("6.00")
    budget = BudgetedLLM(primary, fallback, budget_usd=5.0, spend_path=tmp_path / "spend.json")

    out = budget("sys", "user")

    assert out == "fallback-ok"
    assert primary.calls == 0
    assert fallback.calls == 1


def test_primary_exception_falls_back_to_ollama(tmp_path):
    primary = _FakePrimary(raise_exc=RuntimeError("anthropic down"))
    fallback = _FakeFallback()
    budget = BudgetedLLM(primary, fallback, budget_usd=5.0, spend_path=tmp_path / "spend.json")

    out = budget("sys", "user")

    assert out == "fallback-ok"
    assert primary.calls == 1
    assert fallback.calls == 1


def test_spend_persists_across_instances(tmp_path):
    primary = _FakePrimary(in_tokens=2_000_000, out_tokens=0)  # $6 per call
    fallback = _FakeFallback()
    path = tmp_path / "spend.json"

    BudgetedLLM(primary, fallback, budget_usd=10.0, spend_path=path)("s", "u")
    # Fresh instance reads the same spend file.
    b2 = BudgetedLLM(_FakePrimary(), _FakeFallback(), budget_usd=10.0, spend_path=path)
    assert b2.spent() == pytest.approx(6.0, rel=1e-3)


def test_compute_cost_uses_per_million_rates():
    # 1,000,000 input + 500,000 output at Sonnet rates = $3 + $7.5 = $10.5
    cost = _compute_cost(
        "claude-sonnet-4-6",
        {"input_tokens": 1_000_000, "output_tokens": 500_000},
    )
    assert cost == pytest.approx(10.5, rel=1e-3)


def test_unknown_model_uses_default_pricing_not_zero():
    # Never return 0 for an unknown model — that would bypass the cap silently.
    cost = _compute_cost("some-future-model", {"input_tokens": 1_000_000, "output_tokens": 0})
    assert cost > 0
