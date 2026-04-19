import json

import pytest

from lighthouse.models import MatchedPerson, Thesis
from lighthouse.outreach import OutreachDrafter


@pytest.fixture
def thesis():
    return Thesis(
        moat="last-mile routing for tier-2 freight",
        themes=["logistics", "routing"],
        icp={"industry": "logistics"},
        ideal_hire={"role": "Staff Engineer"},
    )


def _matched(name: str, score: float = 80.0) -> MatchedPerson:
    return MatchedPerson(
        name=name,
        title="Partner",
        company=f"{name} Ventures",
        linkedin=f"https://linkedin.com/in/{name.lower()}",
        recent_post=f"I posted about logistics on 2026-04-14 — {name}",
        recent_post_url="https://example.com/post",
        recent_post_date="2026-04-14",
        score=score,
        sub_scores={"thesis_match": 35},
    )


@pytest.fixture
def by_track():
    return {
        "investor": [_matched("Alice"), _matched("Bob")],
        "design_partner": [_matched("Cara")],
        "talent": [_matched("Devi"), _matched("Eli")],
    }


def test_outreach_drafter_populates_warm_intro_per_person(thesis, by_track):
    def fake_llm(system, user):
        people = json.loads(user)["people"]
        return json.dumps(
            {"drafts": {p["id"]: f"draft for {p['name']}" for p in people}}
        )

    out = OutreachDrafter(llm=fake_llm).draft(thesis, by_track)

    assert set(out.keys()) == {"investor", "design_partner", "talent"}
    assert out["investor"][0].warm_intro_draft == "draft for Alice"
    assert out["investor"][1].warm_intro_draft == "draft for Bob"
    assert out["design_partner"][0].warm_intro_draft == "draft for Cara"
    assert out["talent"][0].warm_intro_draft == "draft for Devi"
    assert out["talent"][1].warm_intro_draft == "draft for Eli"


def test_outreach_drafter_preserves_non_draft_fields(thesis, by_track):
    def fake_llm(system, user):
        return json.dumps({"drafts": {"investor_0": "hi"}})

    out = OutreachDrafter(llm=fake_llm).draft(thesis, by_track)
    alice = out["investor"][0]
    assert alice.name == "Alice"
    assert alice.title == "Partner"
    assert alice.score == 80.0


def test_outreach_drafter_assigns_stable_ids_per_track(thesis, by_track):
    captured = {}

    def fake_llm(system, user):
        captured["user"] = user
        return json.dumps({"drafts": {}})

    OutreachDrafter(llm=fake_llm).draft(thesis, by_track)
    payload = json.loads(captured["user"])
    ids = [p["id"] for p in payload["people"]]
    assert "investor_0" in ids
    assert "investor_1" in ids
    assert "design_partner_0" in ids
    assert "talent_0" in ids
    assert "talent_1" in ids
    for p in payload["people"]:
        assert "track" in p
        assert p["track"] in ("investor", "design_partner", "talent")


def test_outreach_drafter_leaves_missing_drafts_as_empty_string(thesis, by_track):
    def fake_llm(system, user):
        return json.dumps({"drafts": {"investor_0": "only alice got a draft"}})

    out = OutreachDrafter(llm=fake_llm).draft(thesis, by_track)
    assert out["investor"][0].warm_intro_draft == "only alice got a draft"
    assert out["investor"][1].warm_intro_draft == ""
    assert out["talent"][0].warm_intro_draft == ""


def test_outreach_drafter_strips_markdown_fence(thesis, by_track):
    def fake_llm(system, user):
        return "```json\n" + json.dumps({"drafts": {"investor_0": "x"}}) + "\n```"

    out = OutreachDrafter(llm=fake_llm).draft(thesis, by_track)
    assert out["investor"][0].warm_intro_draft == "x"
