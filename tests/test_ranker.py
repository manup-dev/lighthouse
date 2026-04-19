import json

import pytest

from lighthouse.models import MatchedPerson, ReQueryRequest, Thesis
from lighthouse.ranker import RankOutcome, Ranker


@pytest.fixture
def thesis():
    return Thesis(
        moat="last-mile routing",
        themes=["logistics", "routing"],
        icp={"industry": "logistics"},
        ideal_hire={"role": "Staff Engineer"},
    )


@pytest.fixture
def talent_candidates():
    return [
        {"name": "Jane", "title": "Staff Eng", "company": "Delhivery", "linkedin": "url-1", "recent_post": "built a VRP solver"},
        {"name": "Ravi", "title": "Principal Eng", "company": "Shiprocket", "linkedin": "url-2"},
        {"name": "Meera", "title": "VP Eng", "company": "Rivigo", "linkedin": "url-3"},
        {"name": "Arjun", "title": "Director Eng", "company": "Porter", "linkedin": "url-4"},
        {"name": "Divya", "title": "Staff Eng", "company": "LocoNav", "linkedin": "url-5"},
        {"name": "Noise", "title": "Recruiter", "company": "X"},
    ]


def _fake_match(name: str, linkedin: str, score: float) -> dict:
    return {
        "name": name,
        "title": "Staff Engineer",
        "company": "Acme",
        "linkedin": linkedin,
        "recent_post": "built a VRP solver",
        "recent_post_url": "https://example.com/post",
        "recent_post_date": "2026-04-14",
        "geo_distance_km": 12.3,
        "score": score,
        "sub_scores": {"skill_match": 32, "prior_employer_prestige": 18, "seniority_fit": 18, "recency": 12, "geo_fit": 8},
        "warm_intro_draft": "",
    }


def test_ranker_returns_rank_outcome(thesis, talent_candidates):
    def fake_llm(system, user):
        return json.dumps(
            {
                "matches": [_fake_match(f"N{i}", f"url-{i}", 90 - i) for i in range(5)],
                "requery": None,
            }
        )

    out = Ranker(llm=fake_llm).rank(thesis, candidates=talent_candidates, track="talent")

    assert isinstance(out, RankOutcome)
    assert len(out.matches) == 5
    assert all(isinstance(m, MatchedPerson) for m in out.matches)
    assert out.requery is None


def test_ranker_preserves_order_from_llm(thesis, talent_candidates):
    def fake_llm(system, user):
        return json.dumps(
            {
                "matches": [
                    _fake_match("High", "url-a", 95),
                    _fake_match("Mid", "url-b", 70),
                    _fake_match("Low", "url-c", 55),
                ],
                "requery": None,
            }
        )

    out = Ranker(llm=fake_llm).rank(thesis, candidates=talent_candidates, track="talent")
    assert [m.name for m in out.matches] == ["High", "Mid", "Low"]
    assert out.matches[0].score == 95


def test_ranker_returns_requery_request_when_thin(thesis, talent_candidates):
    def fake_llm(system, user):
        return json.dumps(
            {
                "matches": [_fake_match("Only", "url-a", 55)],
                "requery": {
                    "track": "talent",
                    "reason": "only one viable candidate above threshold",
                    "widen_filters": {"distance": 50, "unit": "km"},
                },
            }
        )

    out = Ranker(llm=fake_llm).rank(thesis, candidates=talent_candidates, track="talent")
    assert isinstance(out.requery, ReQueryRequest)
    assert out.requery.track == "talent"
    assert out.requery.widen_filters["distance"] == 50


def test_ranker_user_payload_includes_track_thesis_candidates(thesis, talent_candidates):
    captured = {}

    def fake_llm(system, user):
        captured["user"] = user
        return json.dumps({"matches": [], "requery": None})

    Ranker(llm=fake_llm).rank(thesis, candidates=talent_candidates, track="investor")
    user_payload = json.loads(captured["user"])
    assert user_payload["track"] == "investor"
    assert user_payload["thesis"]["moat"] == "last-mile routing"
    assert len(user_payload["candidates"]) == len(talent_candidates)


def test_ranker_rejects_invalid_track(thesis):
    with pytest.raises(ValueError):
        Ranker(llm=lambda s, u: "{}").rank(thesis, candidates=[], track="other")


def test_ranker_strips_markdown_fence(thesis):
    def fake_llm(system, user):
        return "```json\n" + json.dumps({"matches": [], "requery": None}) + "\n```"

    out = Ranker(llm=fake_llm).rank(thesis, candidates=[], track="talent")
    assert out.matches == []
