from __future__ import annotations

import time
from typing import Any, Callable, Protocol

from lighthouse.analyzer import RepoAnalyzer
from lighthouse.enricher import Enricher
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


class _TracingLLM:
    """Wraps an LLM callable and emits a log line before/after every call.

    The pipeline swaps in one of these per run so stages that would otherwise
    hang silently on slow local inference surface as live traces ("waiting on
    ollama/qwen…") in the UI.
    """

    def __init__(
        self,
        inner: Callable[[str, str], str],
        on_log: LogCallback | None,
    ):
        self._inner = inner
        self._on_log = on_log
        self._stage: str | None = None
        self.provider = getattr(inner, "provider", None)
        self.model = getattr(inner, "model", None)

    def set_stage(self, stage: str | None) -> None:
        self._stage = stage

    def __call__(self, system: str, user: str) -> str:
        label = f"{self.provider or 'llm'}/{self.model or '?'}"
        if self._on_log:
            self._on_log(
                LogEvent(
                    message=f"→ waiting on {label} — fetching completion…",
                    stage=self._stage,
                )
            )
        t0 = time.monotonic()
        out = self._inner(system, user)
        elapsed = time.monotonic() - t0
        if self._on_log:
            n = len(out) if isinstance(out, str) else 0
            self._on_log(
                LogEvent(
                    message=f"← {label} returned {n} chars in {elapsed:.1f}s",
                    stage=self._stage,
                )
            )
        return out


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

        # Wrap the LLM so every call emits pre/post traces; re-bind stages to use it.
        traced = _TracingLLM(self.llm, on_log)
        thesis_engine = ThesisEngine(traced)
        query_planner = QueryPlanner(traced)
        ranker = Ranker(traced)
        enricher = Enricher(traced)
        outreach = OutreachDrafter(traced)

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
        traced.set_stage("thesis")
        thesis = thesis_engine.extract(fingerprint, user_hint=user_hint)
        log(f"Thesis moat: “{thesis.moat}”", stage="thesis")
        log(f"Themes: {thesis.themes}", stage="thesis")
        emit("thesis", "done", {"moat": thesis.moat})

        emit("query_plan", "start")
        log("Calling LLM — query planner stage…", stage="query_plan")
        traced.set_stage("query_plan")
        plans = query_planner.plan(
            thesis, location=location, user_hint=user_hint
        )
        for p in plans:
            log(f"↳ [{p.track}] {p.endpoint} — {p.rationale}", stage="query_plan")
        emit("query_plan", "done", {"count": len(plans)})

        emit("crust_fanout", "start", {"queries": len(plans)})
        total = len(plans)
        log(
            f"Fanning out {total} queries to Crustdata — this usually takes ~30–60s…",
            stage="crust_fanout",
        )
        done_count = {"n": 0}

        def _on_start(i: int, plan: CrustQueryPlan) -> None:
            log(
                f"→ [{i + 1}/{total}] {plan.endpoint} [{plan.track}] — dispatching",
                stage="crust_fanout",
            )

        def _on_finish(
            i: int,
            plan: CrustQueryPlan,
            resp: dict | None,
            err: str | None,
        ) -> None:
            done_count["n"] += 1
            progress = f"({done_count['n']}/{total})"
            if err:
                log(
                    f"✗ {plan.endpoint} [{plan.track}] {progress} — {err}",
                    level="warn",
                    stage="crust_fanout",
                )
            else:
                count = len(_extract_candidates(plan.endpoint, resp))
                log(
                    f"✓ {plan.endpoint} [{plan.track}] {progress} → {count} results",
                    stage="crust_fanout",
                )

        # Older CrustLike implementations (dry-run, mocks) may not accept callbacks.
        try:
            raw_results = await self.crust.fan_out(
                plans, on_start=_on_start, on_finish=_on_finish
            )
        except TypeError:
            raw_results = await self.crust.fan_out(plans)
            for item in raw_results:
                track = item.get("track")
                endpoint = item.get("endpoint", "?")
                err = item.get("error")
                if err:
                    log(f"✗ {endpoint} [{track}] — {err}", level="warn", stage="crust_fanout")
                else:
                    count = len(_extract_candidates(endpoint, item.get("response")))
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
        traced.set_stage("ranker")
        for track in _TRACKS:
            n_in = len(candidates_by_track.get(track, []))
            log(f"Ranking {track}: {n_in} candidates…", stage="ranker")
            outcome = ranker.rank(
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

        emit("enricher", "start")
        log(
            "Resolving canonical names + firm logos for each match…",
            stage="enricher",
        )
        traced.set_stage("enricher")
        try:
            ranked = enricher.enrich(ranked)
            n_logos = sum(
                1
                for track in _TRACKS
                for p in ranked.get(track, [])
                if p.logo_url
            )
            log(
                f"↳ logos resolved: {n_logos} across all tracks",
                stage="enricher",
            )
        except Exception as exc:  # noqa: BLE001 — enrichment is best-effort
            log(f"enricher failed: {exc}", level="warn", stage="enricher")
        emit("enricher", "done")

        emit("outreach", "start")
        log("Drafting warm intros for all matches…", stage="outreach")
        traced.set_stage("outreach")
        with_drafts = outreach.draft(thesis, ranked)
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
            candidates = _extract_candidates(item.get("endpoint"), item.get("response"))
            for candidate in candidates:
                url = candidate.get("linkedin") or (
                    candidate.get("social_handles", {})
                    .get("professional_network_identifier", {})
                    .get("profile_url")
                )
                if url:
                    if url in seen_linkedin[track]:
                        continue
                    seen_linkedin[track].add(url)
                by_track[track].append(candidate)
        return by_track


def _extract_candidates(endpoint: str | None, response: dict | None) -> list[dict]:
    """Crustdata uses a different results key per endpoint: `profiles` for
    /person/search, `companies` for /company/search, `results` for
    /web/search/live. Reading the wrong key silently drops real candidates."""
    if not response:
        return []
    if endpoint == "/person/search":
        return response.get("profiles") or []
    if endpoint == "/company/search":
        return response.get("companies") or []
    if endpoint == "/web/search/live":
        return response.get("results") or []
    return (
        response.get("profiles")
        or response.get("companies")
        or response.get("results")
        or []
    )
