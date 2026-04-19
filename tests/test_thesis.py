import json

import pytest
from pydantic import ValidationError

from lighthouse.models import TechFingerprint, Thesis
from lighthouse.thesis import ThesisEngine


SAMPLE_RESPONSE = {
    "moat": "Sub-30-second vehicle routing for tier-2 freight fleets.",
    "themes": ["last-mile routing", "fleet optimisation", "logistics SaaS"],
    "icp": {
        "industry": "freight & logistics",
        "size_range": "50-500",
        "signal_keywords": ["dispatch", "route planning", "VRP"],
    },
    "ideal_hire": {
        "role": "Staff Engineer",
        "seniority": "staff",
        "prior_employer_signals": ["logistics", "ortools", "supply chain"],
    },
}


@pytest.fixture
def fingerprint():
    return TechFingerprint(
        languages=["python", "typescript"],
        frameworks=["fastapi", "next"],
        domain_hints=["logistics"],
        recent_commit_themes=["init router", "add manifest parser"],
        readme_summary="FreightFlow — last-mile fleet routing.",
    )


def test_thesis_engine_returns_thesis_from_llm_json(fingerprint):
    def fake_llm(system: str, user: str) -> str:
        return json.dumps(SAMPLE_RESPONSE)

    engine = ThesisEngine(llm=fake_llm)
    thesis = engine.extract(fingerprint)

    assert isinstance(thesis, Thesis)
    assert thesis.moat.startswith("Sub-30-second")
    assert "fleet optimisation" in thesis.themes
    assert thesis.icp["industry"] == "freight & logistics"
    assert thesis.ideal_hire["role"] == "Staff Engineer"


def test_thesis_engine_sends_system_prompt_and_user_fingerprint(fingerprint):
    captured: dict[str, str] = {}

    def fake_llm(system: str, user: str) -> str:
        captured["system"] = system
        captured["user"] = user
        return json.dumps(SAMPLE_RESPONSE)

    ThesisEngine(llm=fake_llm).extract(fingerprint)

    assert "venture thesis analyst" in captured["system"].lower()
    assert "TechFingerprint" in captured["system"]
    assert "FreightFlow" in captured["user"]
    assert "fastapi" in captured["user"]


def test_thesis_engine_strips_markdown_fence_around_json(fingerprint):
    def fake_llm(system, user):
        return "```json\n" + json.dumps(SAMPLE_RESPONSE) + "\n```"

    thesis = ThesisEngine(llm=fake_llm).extract(fingerprint)
    assert thesis.moat.startswith("Sub-30-second")


def test_thesis_engine_raises_on_invalid_json(fingerprint):
    def fake_llm(system, user):
        return "not json at all"

    with pytest.raises(ValueError):
        ThesisEngine(llm=fake_llm).extract(fingerprint)


def test_thesis_engine_raises_on_schema_mismatch(fingerprint):
    def fake_llm(system, user):
        return json.dumps({"moat": "x"})  # missing themes/icp/ideal_hire

    with pytest.raises(ValidationError):
        ThesisEngine(llm=fake_llm).extract(fingerprint)
