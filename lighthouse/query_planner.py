from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from lighthouse.models import CrustQueryPlan, Thesis
from lighthouse.thesis import _strip_fence

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "query_planner.md"


class QueryPlanner:
    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def plan(self, thesis: Thesis, location: str | None = None) -> list[CrustQueryPlan]:
        user_payload = {
            "thesis": thesis.model_dump(),
            "location": location,
        }
        raw = self._llm(self._system, json.dumps(user_payload))
        cleaned = _strip_fence(raw)
        try:
            items = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"QueryPlanner: LLM did not return valid JSON: {exc}") from exc
        if not isinstance(items, list):
            raise ValueError(f"QueryPlanner: expected JSON array, got {type(items).__name__}")
        return [CrustQueryPlan(**item) for item in items]
