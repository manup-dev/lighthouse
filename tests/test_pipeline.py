import json
from typing import Any

import pytest

from lighthouse.analyzer import RepoAnalyzer
from lighthouse.models import LogEvent, MatchResult, StageEvent
from lighthouse.pipeline import Pipeline


class FakeCrustClient:
    def __init__(self, per_track_results: dict[str, list[dict]] | None = None):
        self._per_track = per_track_results or {
            "investor": [
                {"name": "VC Partner A", "title": "Partner", "company": "Seed Fund", "linkedin": "url-i1"},
            ],
            "design_partner": [
                {"name": "Acme Corp", "industry": "logistics", "headcount": 200},
            ],
            "talent": [
                {"name": "Staff Eng J", "title": "Staff Engineer", "company": "Delhivery", "linkedin": "url-t1"},
            ],
        }

    async def fan_out(self, plans):
        # Crustdata uses different result keys per endpoint — match real API.
        def _response(endpoint: str, items: list[dict]) -> dict:
            if endpoint == "/company/search":
                return {"companies": items}
            if endpoint == "/web/search/live":
                return {"results": items}
            return {"profiles": items}

        return [
            {
                "track": p.track,
                "endpoint": p.endpoint,
                "rationale": p.rationale,
                "response": _response(p.endpoint, self._per_track.get(p.track, [])),
                "error": None,
            }
            for p in plans
        ]


def _make_llm_router() -> callable:
    """Returns a stateful fake LLM that emits different JSON depending on the prompt."""
    call_counter = {"n": 0}

    def fake_llm(system: str, user: str) -> str:
        call_counter["n"] += 1
        sys_lower = system.lower()
        if "venture thesis analyst" in sys_lower:
            return json.dumps(
                {
                    "moat": "Sub-30-second vehicle routing for tier-2 freight fleets.",
                    "themes": ["last-mile routing", "fleet optimisation", "logistics SaaS"],
                    "icp": {
                        "industry": "freight & logistics",
                        "size_range": "50-500",
                        "signal_keywords": ["dispatch", "route planning"],
                    },
                    "ideal_hire": {
                        "role": "Staff Engineer",
                        "seniority": "staff",
                        "prior_employer_signals": ["logistics"],
                    },
                }
            )
        if "query payloads" in sys_lower or "crustdata-native" in sys_lower:
            return json.dumps(
                [
                    {"endpoint": "/person/search", "track": "investor", "payload": {"filters": {}}, "rationale": "vc partners"},
                    {"endpoint": "/company/search", "track": "design_partner", "payload": {"filters": {}}, "rationale": "logistics mid-market"},
                    {"endpoint": "/person/search", "track": "talent", "payload": {"filters": {}}, "rationale": "staff ICs"},
                ]
            )
        if "rank candidates" in sys_lower:
            user_data = json.loads(user)
            track = user_data["track"]
            candidates = user_data["candidates"]
            matches = []
            for i, c in enumerate(candidates[:5]):
                matches.append(
                    {
                        "name": c.get("name", f"{track}-{i}"),
                        "title": c.get("title", "Unknown"),
                        "company": c.get("company", "Unknown"),
                        "linkedin": c.get("linkedin"),
                        "recent_post": "they posted",
                        "recent_post_url": "https://example.com/p",
                        "recent_post_date": "2026-04-14",
                        "score": 85.0 - i,
                        "sub_scores": {"a": 30, "b": 55 - i},
                        "warm_intro_draft": "",
                    }
                )
            return json.dumps({"matches": matches, "requery": None})
        if "clean up messy candidate records" in sys_lower:
            data = json.loads(user)
            name = data.get("name") or ""
            company = data.get("company") or ""
            return json.dumps(
                {
                    "kind": "person" if data.get("linkedin") else "organization",
                    "name": name or company,
                    "firm": company or name,
                    "domain": "example.com" if company else "",
                }
            )
        if "warm-intro" in sys_lower or "founder" in sys_lower and "draft" in sys_lower:
            data = json.loads(user)
            drafts = {p["id"]: f"Hi {p['name']} — saw your post. We're building {data['thesis']['moat']}." for p in data["people"]}
            return json.dumps({"drafts": drafts})
        raise AssertionError(f"unexpected prompt: {system[:120]!r}")

    return fake_llm


async def test_pipeline_run_returns_match_result(tmp_path):
    llm = _make_llm_router()
    crust = FakeCrustClient()

    result = await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
        location="Bangalore",
    )

    assert isinstance(result, MatchResult)
    assert result.repo_url == "tests/fixtures/repos/demo_repo"
    assert result.thesis.moat.startswith("Sub-30-second")
    assert len(result.query_plan) == 3
    assert len(result.investors) >= 1
    assert len(result.design_partners) >= 1
    assert len(result.talent) >= 1


async def test_pipeline_populates_warm_intros():
    llm = _make_llm_router()
    crust = FakeCrustClient()
    result = await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
    )
    for person in result.investors + result.design_partners + result.talent:
        assert person.warm_intro_draft != ""
        assert "Sub-30-second" in person.warm_intro_draft


async def test_pipeline_emits_stage_events_in_order():
    llm = _make_llm_router()
    crust = FakeCrustClient()
    events: list[StageEvent] = []

    await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
        on_event=events.append,
    )

    stages_in_order = [ev.stage for ev in events if ev.status in ("start", "done")]
    # at least one start and one done per stage
    for stage in ("analyzer", "thesis", "query_plan", "crust_fanout", "ranker", "outreach"):
        assert stage in stages_in_order, f"missing stage {stage}"

    # last event should be the final "done" for the pipeline
    assert events[-1].status == "done"


async def test_pipeline_stats_include_counts_and_duration():
    llm = _make_llm_router()
    crust = FakeCrustClient()
    result = await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
    )
    assert "duration_sec" in result.stats
    assert result.stats["duration_sec"] >= 0
    assert "candidate_counts" in result.stats
    assert result.stats["candidate_counts"]["investor"] >= 1


async def test_pipeline_emits_log_events_with_trace_detail():
    """The pipeline should emit free-form log lines via `on_log` covering each
    LLM call and each Crustdata fan-out result."""
    llm = _make_llm_router()
    crust = FakeCrustClient()
    logs: list[LogEvent] = []

    await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
        on_log=logs.append,
    )

    assert len(logs) > 0
    for e in logs:
        assert isinstance(e, LogEvent)
        assert e.message  # non-empty

    joined = " | ".join(e.message.lower() for e in logs)

    # At minimum: analyzer, thesis LLM, query plan LLM, crust results, rank calls, outreach
    assert "analys" in joined or "analyz" in joined
    assert "thesis" in joined
    assert "query plan" in joined or "planner" in joined
    assert "crust" in joined or "/person/search" in joined or "/company/search" in joined
    assert "rank" in joined
    assert "outreach" in joined or "draft" in joined


async def test_pipeline_emits_pre_llm_fetching_log_with_provider_and_model():
    """Before each LLM call, a log line should appear naming provider+model so
    the UI can show what the pipeline is waiting on during slow local inference."""
    llm = _make_llm_router()
    llm.provider = "ollama"  # type: ignore[attr-defined]
    llm.model = "qwen2.5:14b-instruct-q4_K_M"  # type: ignore[attr-defined]
    crust = FakeCrustClient()
    logs: list[LogEvent] = []

    await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
        on_log=logs.append,
    )

    fetching = [
        e for e in logs
        if "fetching" in e.message.lower() or "waiting on" in e.message.lower()
    ]
    # thesis + planner + 3 rankers + outreach = 6 LLM calls
    assert len(fetching) >= 6, f"expected ≥6 fetching logs, got {len(fetching)}"
    for e in fetching:
        assert "ollama" in e.message.lower()
        assert "qwen" in e.message.lower()


async def test_pipeline_stats_expose_provider_and_model_from_llm():
    from lighthouse.llm import OllamaLLM

    llm = _make_llm_router()
    # shim provider + model onto the fake callable
    llm.provider = "ollama"  # type: ignore[attr-defined]
    llm.model = "qwen2.5:14b-instruct-q4_K_M"  # type: ignore[attr-defined]
    crust = FakeCrustClient()
    result = await Pipeline(llm=llm, crust=crust).run(
        repo_url="tests/fixtures/repos/demo_repo",
    )
    assert result.stats["provider"] == "ollama"
    assert result.stats["model"] == "qwen2.5:14b-instruct-q4_K_M"

    # Real OllamaLLM class attrs exposed
    assert OllamaLLM.provider == "ollama"
