from __future__ import annotations

import time
from typing import Any, Callable, Protocol

from lighthouse.analyzer import RepoAnalyzer
from lighthouse.models import (
    CrustQueryPlan,
    LogEvent,
    MatchResult,
    StageEvent,
    Thesis,
)
from lighthouse.outreach import OutreachDrafter
from lighthouse.query_planner import QueryPlanner
from lighthouse.ranker import Ranker
from lighthouse.thesis import LLM, ThesisEngine


class CrustLike(Protocol):
    async def fan_out(self, plans: list[CrustQueryPlan]) -> list[dict[str, Any]]: ...


EventCallback = Callable[[StageEvent], None]
LogCallback = Callable[[LogEvent], None]
_TRACKS = ("investor", "design_partner", "talent")


class Pipeline:
    def __init__(
        self,
        llm: LLM,
        crust: CrustLike,
        analyzer: RepoAnalyzer | None = None,
    ):
        self.llm = llm
        self.crust = crust
        self.analyzer = analyzer or RepoAnalyzer()
        self.thesis_engine = ThesisEngine(llm)
        self.query_planner = QueryPlanner(llm)
        self.ranker = Ranker(llm)
        self.outreach = OutreachDrafter(llm)

    async def run(
        self,
        repo_url: str,
        location: str | None = None,
        on_event: EventCallback | None = None,
        on_log: LogCallback | None = None,
        user_hint: str | None = None,
    ) -> MatchResult:
        def emit(stage: str, status: str, payload: dict[str, Any] | None = None) -> None:
            if on_event:
                on_event(StageEvent(stage=stage, status=status, payload=payload))

        def log(message: str, level: str = "info", stage: str | None = None) -> None:
            if on_log:
                on_log(LogEvent(message=message, level=level, stage=stage))

        provider = getattr(self.llm, "provider", None)
        model = getattr(self.llm, "model", None)

        started = time.monotonic()

        log(f"Pipeline starting — provider={provider} model={model}", stage="pipeline")

        emit("analyzer", "start")
        log(f"Analysing repo: {repo_url}", stage="analyzer")
        fingerprint = self.analyzer.analyze(repo_url)
        log(
            f"Detected languages={fingerprint.languages} "
            f"frameworks={fingerprint.frameworks} "
            f"hints={fingerprint.domain_hints}",
            stage="analyzer",
        )
        emit("analyzer", "done", {"languages": fingerprint.languages})

        emit("thesis", "start")
        if user_hint:
            log(f"User hint: “{user_hint}”", stage="thesis")
        log("Calling LLM to extract venture thesis…", stage="thesis")
        thesis = self.thesis_engine.extract(fingerprint, user_hint=user_hint)
        log(f"Thesis moat: “{thesis.moat}”", stage="thesis")
        log(f"Themes: {thesis.themes}", stage="thesis")
        emit("thesis", "done", {"moat": thesis.moat})

        emit("query_plan", "start")
        log("Calling LLM — query planner stage…", stage="query_plan")
        plans = self.query_planner.plan(
            thesis, location=location, user_hint=user_hint
        )
        for p in plans:
            log(f"↳ [{p.track}] {p.endpoint} — {p.rationale}", stage="query_plan")
        emit("query_plan", "done", {"count": len(plans)})

        emit("crust_fanout", "start", {"queries": len(plans)})
        log(f"Fanning out {len(plans)} queries to Crustdata…", stage="crust_fanout")
        raw_results = await self.crust.fan_out(plans)
        for item in raw_results:
            track = item.get("track")
            endpoint = item.get("endpoint", "?")
            err = item.get("error")
            if err:
                log(f"✗ {endpoint} [{track}] — {err}", level="warn", stage="crust_fanout")
            else:
                count = len((item.get("response") or {}).get("results") or [])
                log(f"✓ {endpoint} [{track}] → {count} results", stage="crust_fanout")
        candidates_by_track = self._group_candidates(raw_results)
        emit(
            "crust_fanout",
            "done",
            {
                "counts": {t: len(candidates_by_track.get(t, [])) for t in _TRACKS},
            },
        )

        emit("ranker", "start")
        ranked = {}
        for track in _TRACKS:
            n_in = len(candidates_by_track.get(track, []))
            log(f"Ranking {track}: {n_in} candidates…", stage="ranker")
            outcome = self.ranker.rank(
                thesis,
                candidates=candidates_by_track.get(track, []),
                track=track,
            )
            ranked[track] = outcome.matches
            log(f"↳ {track}: {len(outcome.matches)} matches kept", stage="ranker")
        emit(
            "ranker",
            "done",
            {"counts": {t: len(ranked[t]) for t in _TRACKS}},
        )

        emit("outreach", "start")
        log("Drafting warm intros for all matches…", stage="outreach")
        with_drafts = self.outreach.draft(thesis, ranked)
        emit("outreach", "done")

        stats = {
            "duration_sec": round(time.monotonic() - started, 3),
            "candidate_counts": {
                t: len(candidates_by_track.get(t, [])) for t in _TRACKS
            },
            "query_count": len(plans),
            "provider": getattr(self.llm, "provider", None),
            "model": getattr(self.llm, "model", None),
        }

        result = MatchResult(
            repo_url=repo_url,
            thesis=thesis,
            query_plan=plans,
            investors=with_drafts.get("investor", []),
            design_partners=with_drafts.get("design_partner", []),
            talent=with_drafts.get("talent", []),
            stats=stats,
        )

        emit("pipeline", "done", {"duration_sec": stats["duration_sec"]})
        return result

    @staticmethod
    def _group_candidates(raw_results: list[dict[str, Any]]) -> dict[str, list[dict]]:
        by_track: dict[str, list[dict]] = {t: [] for t in _TRACKS}
        seen_linkedin: dict[str, set[str]] = {t: set() for t in _TRACKS}
        for item in raw_results:
            track = item.get("track")
            if track not in by_track:
                continue
            response = item.get("response") or {}
            for candidate in response.get("results") or []:
                url = candidate.get("linkedin")
                if url:
                    if url in seen_linkedin[track]:
                        continue
                    seen_linkedin[track].add(url)
                by_track[track].append(candidate)
        return by_track
