from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from lighthouse.models import MatchedPerson, ReQueryRequest, Thesis
from lighthouse.thesis import LLM, _strip_fence

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "ranker.md"

Track = Literal["investor", "design_partner", "talent"]
_VALID_TRACKS = ("investor", "design_partner", "talent")


class RankOutcome(BaseModel):
    matches: list[MatchedPerson]
    requery: ReQueryRequest | None = None


class Ranker:
    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def rank(
        self,
        thesis: Thesis,
        candidates: list[dict],
        track: Track,
    ) -> RankOutcome:
        if track not in _VALID_TRACKS:
            raise ValueError(f"invalid track {track!r}; expected one of {_VALID_TRACKS}")
        user_payload = {
            "track": track,
            "thesis": thesis.model_dump(),
            "candidates": candidates,
        }
        raw = self._llm(self._system, json.dumps(user_payload))
        cleaned = _strip_fence(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Ranker: LLM did not return valid JSON: {exc}") from exc
        return RankOutcome(**data)
