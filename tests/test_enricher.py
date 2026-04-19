import json

import pytest

from lighthouse.enricher import Enricher, _coerce_domain
from lighthouse.models import MatchedPerson


def _person(**overrides) -> MatchedPerson:
    base = dict(
        name="placeholder",
        title="",
        company="",
        linkedin=None,
        recent_post=None,
        recent_post_url=None,
        recent_post_date=None,
        geo_distance_km=None,
        score=80.0,
        sub_scores={"x": 1.0},
        warm_intro_draft="",
    )
    base.update(overrides)
    return MatchedPerson(**base)


def test_coerce_domain_strips_scheme_and_path():
    assert _coerce_domain("https://Sequoiacap.com/about") == "sequoiacap.com"
    assert _coerce_domain(" sequoiacap.com ") == "sequoiacap.com"


def test_coerce_domain_blocks_generic_hosts():
    for bad in ("linkedin.com", "www.linkedin.com", "google.com", "medium.com"):
        assert _coerce_domain(bad) is None


def test_coerce_domain_rejects_garbage():
    assert _coerce_domain("") is None
    assert _coerce_domain(None) is None
    assert _coerce_domain("not a domain") is None
    assert _coerce_domain("localhost") is None


def test_enrich_one_populates_logo_url_from_domain():
    def llm(system: str, user: str) -> str:
        return json.dumps(
            {
                "kind": "organization",
                "name": "Sequoia",
                "firm": "Sequoia",
                "domain": "sequoiacap.com",
            }
        )

    enricher = Enricher(llm)
    messy = _person(name="Sequoia Capital: The decade ahead in freight")
    out = enricher.enrich_one(messy, track="investor")

    assert out.logo_url == "https://logo.clearbit.com/sequoiacap.com"
    assert out.name == "Sequoia"  # organization rewrite took over the page title
    assert out.company == "Sequoia"


def test_enrich_one_is_noop_on_llm_error():
    def llm(system: str, user: str) -> str:
        raise RuntimeError("ollama down")

    enricher = Enricher(llm)
    before = _person(name="A. Person", company="Accel")
    after = enricher.enrich_one(before, track="investor")
    assert after == before


def test_enrich_one_is_noop_on_invalid_json():
    def llm(system: str, user: str) -> str:
        return "not json at all"

    enricher = Enricher(llm)
    before = _person(name="A. Person", company="Accel")
    after = enricher.enrich_one(before, track="investor")
    assert after == before


def test_enrich_one_skips_blocked_domain():
    def llm(system: str, user: str) -> str:
        return json.dumps(
            {"kind": "organization", "name": "LI page", "firm": "LI page", "domain": "linkedin.com"}
        )

    enricher = Enricher(llm)
    out = enricher.enrich_one(_person(), track="investor")
    assert out.logo_url is None


def test_enrich_keeps_person_name_when_kind_person():
    def llm(system: str, user: str) -> str:
        return json.dumps(
            {
                "kind": "person",
                "name": "Priya S",
                "firm": "Google Maps",
                "domain": "google.com",  # blocked → no logo
            }
        )

    enricher = Enricher(llm)
    before = _person(
        name="Priya Subramanian",
        title="Principal Engineer",
        company="Google Maps",
        linkedin="https://linkedin.com/in/priyas",
    )
    after = enricher.enrich_one(before, track="talent")
    # Person-kind: never overwrite with a shorter nickname — original wins.
    assert after.name == "Priya Subramanian"
    assert after.logo_url is None
