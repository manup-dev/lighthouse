"""Tests for JDMatcher — recruiter-mode entrypoint.

Given a job description (free-form text) instead of a repo URL, the matcher:
1. Extracts a Thesis from the JD via the LLM
2. Plans Crustdata queries (talent only)
3. Fans out, ranks, and drafts warm intros for the talent track
"""

from __future__ import annotations

import json

import pytest

from lighthouse.jd_matcher import JDMatcher
from lighthouse.models import MatchedPerson, Thesis


SAMPLE_JD = (
    "Staff Backend Engineer — Freight Tech\n"
    "We're building real-time dispatch optimisation for Indian freight fleets.\n"
    "Looking for someone with 8+ years of experience, production Go/Python,\n"
    "prior time at Delhivery / Shiprocket / Porter, based in Bangalore."
)


def _fake_llm_router() -> callable:
    """Stateful fake: returns JD-thesis JSON, plan JSON, rank JSON, drafts JSON."""

    def fake_llm(system: str, user: str) -> str:
        sys_lower = system.lower()
        # Order matters: query_planner prompt mentions "recruiter titles" as an
        # exclusion hint, so match the specific planner markers FIRST.
        if "query payloads" in sys_lower or "crustdata-native" in sys_lower:
            return json.dumps(
                [
                    {
                        "endpoint": "/person/search",
                        "track": "investor",
                        "payload": {"filters": {}},
                        "rationale": "should be filtered out",
                    },
                    {
                        "endpoint": "/person/search",
                        "track": "talent",
                        "payload": {"filters": {}},
                        "rationale": "senior backend ICs in Bangalore",
                    },
                ]
            )
        if "structured search thesis" in sys_lower or "recruiter's assistant" in sys_lower:
            return json.dumps(
                {
                    "moat": "Real-time dispatch optimisation for freight fleets.",
                    "themes": ["dispatch", "freight", "logistics"],
                    "icp": {
                        "industry": "freight & logistics",
                        "size_range": "200-2000",
                        "signal_keywords": ["dispatch", "fleet"],
                    },
                    "ideal_hire": {
                        "role": "Staff Backend Engineer",
                        "seniority": "staff",
                        "prior_employer_signals": [
                            "Delhivery",
                            "Shiprocket",
                            "Porter",
                        ],
                    },
                }
            )
        if "rank candidates" in sys_lower:
            data = json.loads(user)
            candidates = data["candidates"]
            return json.dumps(
                {
                    "matches": [
                        {
                            "name": c.get("name", f"cand-{i}"),
                            "title": c.get("title", "Staff Engineer"),
                            "company": c.get("company", "Delhivery"),
                            "linkedin": c.get("linkedin"),
                            "recent_post": "Scaling dispatch to 10k vehicles",
                            "recent_post_url": "https://example.com/p",
                            "recent_post_date": "2026-04-12",
                            "score": 88.0 - i,
                            "sub_scores": {"role_fit": 45.0, "signal": 43.0 - i},
                            "warm_intro_draft": "",
                        }
                        for i, c in enumerate(candidates[:5])
                    ],
                    "requery": None,
                }
            )
        if "warm-intro" in sys_lower or "founder" in sys_lower and "draft" in sys_lower:
            data = json.loads(user)
            drafts = {
                p["id"]: f"Hi {p['name']} — saw your post on dispatch." for p in data["people"]
            }
            return json.dumps({"drafts": drafts})
        raise AssertionError(f"unexpected prompt: {system[:80]!r}")

    return fake_llm


class FakeCrust:
    def __init__(self, per_track: dict | None = None):
        self._per_track = per_track or {
            "talent": [
                {
                    "name": "Staff Eng J",
                    "title": "Staff Engineer",
                    "company": "Delhivery",
                    "linkedin": "url-t1",
                },
                {
                    "name": "Principal Eng K",
                    "title": "Principal Engineer",
                    "company": "Shiprocket",
                    "linkedin": "url-t2",
                },
            ]
        }

    async def fan_out(self, plans):
        return [
            {
                "track": p.track,
                "endpoint": p.endpoint,
                "rationale": p.rationale,
                "response": {"results": self._per_track.get(p.track, [])},
                "error": None,
            }
            for p in plans
        ]


async def test_jd_matcher_returns_matched_people():
    llm = _fake_llm_router()
    crust = FakeCrust()

    matches = await JDMatcher(llm=llm, crust=crust).match(
        jd=SAMPLE_JD, location="Bangalore"
    )

    assert len(matches) >= 1
    for m in matches:
        assert isinstance(m, MatchedPerson)
        assert m.warm_intro_draft  # non-empty
        assert m.score > 0


async def test_jd_matcher_only_runs_talent_track(monkeypatch):
    """Investor/design_partner plans from the planner must be filtered out
    before the Crust fan-out."""
    llm = _fake_llm_router()

    seen_tracks: list[str] = []

    class TrackCaptureCrust:
        async def fan_out(self, plans):
            for p in plans:
                seen_tracks.append(p.track)
            return [
                {
                    "track": p.track,
                    "response": {
                        "results": [
                            {
                                "name": "Cand",
                                "title": "Staff",
                                "company": "X",
                                "linkedin": f"url-{p.track}",
                            }
                        ]
                    },
                }
                for p in plans
            ]

    crust = TrackCaptureCrust()
    await JDMatcher(llm=llm, crust=crust).match(jd=SAMPLE_JD)

    # The fake planner returns ["investor", "talent"]; only talent should hit crust
    assert "investor" not in seen_tracks
    assert "talent" in seen_tracks


def test_jd_matcher_extracts_thesis_from_jd():
    llm = _fake_llm_router()
    crust = FakeCrust()
    matcher = JDMatcher(llm=llm, crust=crust)
    thesis = matcher.thesis_from_jd(SAMPLE_JD)

    assert isinstance(thesis, Thesis)
    assert "dispatch" in thesis.moat.lower()
    assert thesis.ideal_hire["role"] == "Staff Backend Engineer"


def test_jd_matcher_strips_markdown_fence_around_thesis_json():
    def fake_llm(system, user):
        return (
            "```json\n"
            + json.dumps(
                {
                    "moat": "X",
                    "themes": [],
                    "icp": {"industry": "y"},
                    "ideal_hire": {"role": "Eng"},
                }
            )
            + "\n```"
        )

    matcher = JDMatcher(llm=fake_llm, crust=FakeCrust())
    thesis = matcher.thesis_from_jd("irrelevant")
    assert thesis.moat == "X"
