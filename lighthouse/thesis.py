from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from lighthouse.models import TechFingerprint, Thesis

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "thesis.md"

_REPAIR_SUFFIX = (
    "\n\nCRITICAL: return ONLY valid JSON — no prose, no markdown fences, no "
    "comments, no trailing commas. Your previous response did not parse."
)


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


def _best_effort_extract(text: str, kind: str) -> str:
    """Second-chance extraction — pull the first `{...}` or `[...]` block out
    of a noisy response before giving up.

    Local 14B models sometimes prefix JSON with a sentence or wrap it in stray
    markdown; strip-fence catches fences but not free-form prose."""
    s = _strip_fence(text)
    opener, closer = ("[", "]") if kind == "array" else ("{", "}")
    start = s.find(opener)
    end = s.rfind(closer)
    if start == -1 or end == -1 or end <= start:
        return s
    return s[start : end + 1]


def call_llm_for_json(
    llm: LLM,
    system: str,
    user: str,
    *,
    stage: str,
    expect: str = "object",
    max_retries: int = 2,
):
    """Call `llm(system, user)` expecting a JSON response; retry on parse failure.

    Local Qwen 14B intermittently returns un-parseable responses (stray prose,
    malformed trailing commas, empty string). We retry up to `max_retries`
    times with a stricter system prompt before bubbling the error up to the
    pipeline. `stage` is used only to label the eventual error message so the
    failure points at the stage that actually broke."""
    last_exc: Exception | None = None
    sys_prompt = system
    for attempt in range(max_retries + 1):
        raw = llm(sys_prompt, user)
        cleaned = _strip_fence(raw)
        candidates = [cleaned, _best_effort_extract(raw, expect)]
        for candidate in candidates:
            if not candidate:
                continue
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError as exc:
                last_exc = exc
                continue
            if expect == "array" and not isinstance(parsed, list):
                last_exc = ValueError(
                    f"expected JSON array, got {type(parsed).__name__}"
                )
                continue
            if expect == "object" and not isinstance(parsed, dict):
                last_exc = ValueError(
                    f"expected JSON object, got {type(parsed).__name__}"
                )
                continue
            return parsed
        # Stricter prompt for the next attempt.
        sys_prompt = system + _REPAIR_SUFFIX
    raise ValueError(
        f"{stage}: LLM did not return valid JSON after {max_retries + 1} attempts: {last_exc}"
    )


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
        data = call_llm_for_json(
            self._llm,
            self._system,
            json.dumps(payload),
            stage="ThesisEngine",
            expect="object",
        )
        return Thesis(**data)
