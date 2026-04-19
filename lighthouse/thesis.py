from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from lighthouse.models import TechFingerprint, Thesis

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "thesis.md"


def _strip_fence(text: str) -> str:
    s = text.strip()
    if not s.startswith("```"):
        return s
    lines = s.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


class ThesisEngine:
    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def extract(
        self, fingerprint: TechFingerprint, user_hint: str | None = None
    ) -> Thesis:
        payload: dict = json.loads(fingerprint.model_dump_json())
        if user_hint:
            payload["user_hint"] = user_hint
        raw = self._llm(self._system, json.dumps(payload))
        cleaned = _strip_fence(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"ThesisEngine: LLM did not return valid JSON: {exc}") from exc
        return Thesis(**data)
