import pytest
from pydantic import ValidationError

from lighthouse.models import (
    CompanyCandidate,
    CrustQueryPlan,
    MatchedPerson,
    MatchResult,
    PersonCandidate,
    ReQueryRequest,
    StageEvent,
    TechFingerprint,
    Thesis,
)


def test_tech_fingerprint_happy_path():
    fp = TechFingerprint(
        languages=["python", "typescript"],
        frameworks=["fastapi", "next"],
        domain_hints=["devtools"],
        recent_commit_themes=["add cli", "fix auth"],
        readme_summary="A founder command center.",
    )
    assert fp.languages == ["python", "typescript"]
    assert fp.readme_summary.startswith("A founder")


def test_thesis_happy_path_with_nested_dicts():
    thesis = Thesis(
        moat="async pipeline over Crustdata with grounded outreach",
        themes=["AI agents", "data fabric", "warm intros"],
        icp={"industry": "devtools", "size_range": "50-500", "signal_keywords": ["ai", "data"]},
        ideal_hire={"role": "Staff Engineer", "seniority": "staff", "prior_employer_signals": ["FAANG"]},
    )
    assert thesis.icp["industry"] == "devtools"
    assert "warm intros" in thesis.themes


def test_crust_query_plan_track_literal_rejects_invalid():
    with pytest.raises(ValidationError):
        CrustQueryPlan(
            endpoint="/person/search",
            track="random_track",  # invalid
            payload={"filters": {}},
            rationale="test",
        )


def test_crust_query_plan_endpoint_literal_rejects_invalid():
    with pytest.raises(ValidationError):
        CrustQueryPlan(
            endpoint="/person/bogus",  # invalid
            track="talent",
            payload={},
            rationale="test",
        )


def test_crust_query_plan_happy_path():
    plan = CrustQueryPlan(
        endpoint="/person/search",
        track="talent",
        payload={"filters": {"op": "and", "conditions": []}, "limit": 50},
        rationale="geo-restricted senior ICs near Bangalore",
    )
    assert plan.track == "talent"
    assert plan.payload["limit"] == 50


def test_person_candidate_optional_fields_default_none():
    p = PersonCandidate(name="Jane Doe", title="VP Eng", company="Acme")
    assert p.linkedin is None
    assert p.recent_post is None
    assert p.recent_post_url is None
    assert p.recent_post_date is None


def test_person_candidate_required_fields_missing_raises():
    with pytest.raises(ValidationError):
        PersonCandidate(title="VP Eng", company="Acme")  # type: ignore[call-arg]


def test_company_candidate_optional_fields_default_none():
    c = CompanyCandidate(name="Acme Corp")
    assert c.domain is None
    assert c.industry is None
    assert c.headcount is None


def test_matched_person_extends_candidate():
    mp = MatchedPerson(
        name="Jane Doe",
        title="VP Eng",
        company="Acme",
        linkedin="https://linkedin.com/in/janedoe",
        recent_post="We are hiring platform engineers",
        score=87.5,
        sub_scores={"seniority_fit": 30.0, "prior_employer_prestige": 22.0},
        warm_intro_draft="Hi Jane — saw your post...",
    )
    assert mp.score == 87.5
    assert mp.warm_intro_draft.startswith("Hi Jane")
    assert mp.name == "Jane Doe"


def test_stage_event_status_literal_rejects_invalid():
    with pytest.raises(ValidationError):
        StageEvent(stage="analyzer", status="halfway")  # type: ignore[arg-type]


def test_stage_event_payload_optional():
    ev = StageEvent(stage="thesis", status="start")
    assert ev.payload is None


def test_re_query_request_shape():
    r = ReQueryRequest(
        track="talent",
        reason="fewer than 5 viable candidates",
        widen_filters={"distance": 50},
    )
    assert r.track == "talent"
    assert r.widen_filters["distance"] == 50


def test_match_result_serialization_roundtrip():
    thesis = Thesis(
        moat="async pipeline",
        themes=["a", "b"],
        icp={"industry": "x"},
        ideal_hire={"role": "Staff"},
    )
    plan = [
        CrustQueryPlan(
            endpoint="/person/search",
            track="talent",
            payload={"filters": {}},
            rationale="r",
        )
    ]
    matched = MatchedPerson(
        name="Jane",
        title="VP Eng",
        company="Acme",
        score=80.0,
        sub_scores={"x": 10.0},
        warm_intro_draft="hi",
    )
    mr = MatchResult(
        repo_url="https://github.com/manup-dev/lighthouse",
        thesis=thesis,
        query_plan=plan,
        investors=[matched],
        design_partners=[matched],
        talent=[matched],
        stats={"cost_credits": 60, "duration_sec": 19.2},
    )
    js = mr.model_dump_json()
    restored = MatchResult.model_validate_json(js)
    assert restored == mr
    assert restored.talent[0].score == 80.0
