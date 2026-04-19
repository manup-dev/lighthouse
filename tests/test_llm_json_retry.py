"""Verifies the Thesis/QueryPlan/Ranker stages survive one bad JSON response
from a flaky local LLM. Local Qwen 14B occasionally emits un-parseable output;
retrying once with a stricter "return ONLY JSON" nudge is usually enough."""

from __future__ import annotations

import pytest

from lighthouse.thesis import call_llm_for_json


def test_retries_on_invalid_json_and_returns_object():
    calls: list[str] = []

    def flaky_llm(system: str, user: str) -> str:
        calls.append(system)
        if len(calls) == 1:
            return "I cannot JSON"
        return '{"ok": true}'

    data = call_llm_for_json(flaky_llm, "base", "{}", stage="T", expect="object")
    assert data == {"ok": True}
    assert len(calls) == 2
    # Retry used a stricter system prompt (suffix appended).
    assert calls[0] == "base"
    assert "CRITICAL" in calls[1]


def test_extracts_json_block_from_prose():
    def noisy_llm(system: str, user: str) -> str:
        return "Sure thing! Here is the JSON:\n{\"ok\": true}\nLet me know if..."

    data = call_llm_for_json(noisy_llm, "s", "{}", stage="T", expect="object")
    assert data == {"ok": True}


def test_array_expectation_rejects_object():
    calls: list[str] = []

    def llm(system: str, user: str) -> str:
        calls.append(system)
        if len(calls) == 1:
            return '{"not": "array"}'
        return "[1, 2, 3]"

    data = call_llm_for_json(llm, "s", "{}", stage="QP", expect="array")
    assert data == [1, 2, 3]


def test_gives_up_after_max_retries():
    def broken_llm(system: str, user: str) -> str:
        return "<<not json>>"

    with pytest.raises(ValueError, match="after 3 attempts"):
        call_llm_for_json(broken_llm, "s", "{}", stage="T", expect="object", max_retries=2)
