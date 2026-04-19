from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from lighthouse.models import MatchedPerson, ReQueryRequest, Thesis
from lighthouse.thesis import LLM, call_llm_for_json

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

    # Cap input candidates so the ranker prompt fits in the local LLM's context.
    # Qdrant-sized runs fan out ~100+ results per track; Qwen 14B silently
    # returns an empty string when the prompt overflows num_ctx. We only need
    # the top 5 anyway, so feeding more than ~40 candidates is pure overhead.
    MAX_CANDIDATES = 25

    def rank(
        self,
        thesis: Thesis,
        candidates: list[dict],
        track: Track,
    ) -> RankOutcome:
        if track not in _VALID_TRACKS:
            raise ValueError(f"invalid track {track!r}; expected one of {_VALID_TRACKS}")
        trimmed = candidates[: self.MAX_CANDIDATES]
        user_payload = {
            "track": track,
            "thesis": thesis.model_dump(),
            "candidates": trimmed,
        }
        data = call_llm_for_json(
            self._llm,
            self._system,
            json.dumps(user_payload),
            stage="Ranker",
            expect="object",
        )
        return RankOutcome(**data)
