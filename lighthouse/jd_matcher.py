"""Recruiter-mode entrypoint: job description → ranked talent candidates.

Mirror of the repo-mode pipeline, but:
- Thesis is extracted from a JD string instead of a repo fingerprint
- Only the `talent` track is fanned out and ranked
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from lighthouse.models import CrustQueryPlan, MatchedPerson, Thesis
from lighthouse.outreach import OutreachDrafter
from lighthouse.pipeline import _extract_candidates
from lighthouse.query_planner import QueryPlanner
from lighthouse.ranker import Ranker
from lighthouse.thesis import LLM, _strip_fence

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "jd_thesis.md"


class CrustLike(Protocol):
    async def fan_out(self, plans: list[CrustQueryPlan]) -> list[dict[str, Any]]: ...


class JDMatcher:
    def __init__(self, llm: LLM, crust: CrustLike):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        self.crust = crust
        self.query_planner = QueryPlanner(llm)
        self.ranker = Ranker(llm)
        self.outreach = OutreachDrafter(llm)

    def thesis_from_jd(self, jd: str) -> Thesis:
        raw = self._llm(self._system, jd)
        cleaned = _strip_fence(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JDMatcher: LLM did not return valid JSON: {exc}") from exc
        return Thesis(**data)

    async def match(
        self, jd: str, location: str | None = None
    ) -> list[MatchedPerson]:
        thesis = self.thesis_from_jd(jd)
        plans = self.query_planner.plan(thesis, location=location)
        talent_plans = [p for p in plans if p.track == "talent"]

        raw_results = await self.crust.fan_out(talent_plans)
        candidates = self._flatten_talent(raw_results)

        outcome = self.ranker.rank(thesis, candidates=candidates, track="talent")
        with_drafts = self.outreach.draft(thesis, {"talent": outcome.matches})
        return with_drafts.get("talent", [])

    @staticmethod
    def _flatten_talent(raw_results: list[dict[str, Any]]) -> list[dict]:
        seen: set[str] = set()
        out: list[dict] = []
        for item in raw_results:
            candidates = _extract_candidates(item.get("endpoint"), item.get("response"))
            for candidate in candidates:
                url = candidate.get("linkedin") or (
                    candidate.get("social_handles", {})
                    .get("professional_network_identifier", {})
                    .get("profile_url")
                )
                if url:
                    if url in seen:
                        continue
                    seen.add(url)
                out.append(candidate)
        return out
