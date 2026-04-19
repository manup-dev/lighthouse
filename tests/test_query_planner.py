import json

import pytest
from pydantic import ValidationError

from lighthouse.models import CrustQueryPlan, Thesis
from lighthouse.query_planner import QueryPlanner


SAMPLE_PLAN = [
    {
        "endpoint": "/person/search",
        "track": "investor",
        "payload": {
            "filters": {
                "op": "and",
                "conditions": [
                    {
                        "field": "experience.employment_details.title",
                        "type": "(.)",
                        "value": "Partner|General Partner|Principal",
                    }
                ],
            },
            "limit": 50,
        },
        "rationale": "partner-level at seed VCs",
    },
    {
        "endpoint": "/web/search/live",
        "track": "investor",
        "payload": {"query": "last-mile logistics routing", "time_range": "14d"},
        "rationale": "recent VC posts about the thesis themes",
    },
    {
        "endpoint": "/company/search",
        "track": "design_partner",
        "payload": {
            "filters": {
                "op": "and",
                "conditions": [
                    {"field": "taxonomy.professional_network_industry", "type": "=", "value": "Transportation & Logistics"},
                    {"field": "headcount.total", "type": ">", "value": 50},
                ],
            },
            "limit": 50,
        },
        "rationale": "mid-market freight companies",
    },
    {
        "endpoint": "/person/search",
        "track": "talent",
        "payload": {
            "filters": {
                "op": "and",
                "conditions": [
                    {
                        "field": "professional_network.location.raw",
                        "type": "geo_distance",
                        "value": {"location": "Bangalore", "distance": 25, "unit": "km"},
                    },
                    {
                        "field": "experience.employment_details.title",
                        "type": "(.)",
                        "value": "Staff|Principal|Senior|Director|VP|Head of",
                    },
                ],
            },
            "limit": 50,
        },
        "rationale": "senior ICs within 25 km of Bangalore",
    },
]


@pytest.fixture
def thesis():
    return Thesis(
        moat="Sub-30-second vehicle routing for tier-2 freight fleets.",
        themes=["last-mile routing", "fleet optimisation", "logistics SaaS"],
        icp={"industry": "freight & logistics", "size_range": "50-500", "signal_keywords": ["dispatch", "VRP"]},
        ideal_hire={"role": "Staff Engineer", "seniority": "staff", "prior_employer_signals": ["logistics"]},
    )


def test_query_planner_returns_list_of_crust_query_plans(thesis):
    def fake_llm(system, user):
        return json.dumps(SAMPLE_PLAN)

    plans = QueryPlanner(llm=fake_llm).plan(thesis, location="Bangalore")
    assert len(plans) == 4
    for p in plans:
        assert isinstance(p, CrustQueryPlan)


def test_query_planner_preserves_track_labels(thesis):
    def fake_llm(system, user):
        return json.dumps(SAMPLE_PLAN)

    plans = QueryPlanner(llm=fake_llm).plan(thesis, location="Bangalore")
    tracks = {p.track for p in plans}
    assert tracks == {"investor", "design_partner", "talent"}


def test_query_planner_passes_location_to_llm(thesis):
    captured: dict[str, str] = {}

    def fake_llm(system, user):
        captured["system"] = system
        captured["user"] = user
        return json.dumps(SAMPLE_PLAN)

    QueryPlanner(llm=fake_llm).plan(thesis, location="Mumbai")
    user_payload = json.loads(captured["user"])
    assert user_payload["location"] == "Mumbai"
    assert user_payload["thesis"]["moat"].startswith("Sub-30-second")


def test_query_planner_location_defaults_to_none_when_omitted(thesis):
    captured: dict[str, str] = {}

    def fake_llm(system, user):
        captured["user"] = user
        return json.dumps(SAMPLE_PLAN)

    QueryPlanner(llm=fake_llm).plan(thesis)
    user_payload = json.loads(captured["user"])
    assert user_payload["location"] is None


def test_query_planner_strips_markdown_fence(thesis):
    def fake_llm(system, user):
        return "```json\n" + json.dumps(SAMPLE_PLAN) + "\n```"

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    assert len(plans) == 4


def test_query_planner_rejects_invalid_endpoint(thesis):
    bad = [{"endpoint": "/bogus/search", "track": "talent", "payload": {}, "rationale": "x"}]

    def fake_llm(system, user):
        return json.dumps(bad)

    with pytest.raises(ValidationError):
        QueryPlanner(llm=fake_llm).plan(thesis)


def test_query_planner_normalizes_operator_shortcuts(thesis):
    """qwen/GPT-style outputs often use `<=`, `>=`, `=~` — map them to Crustdata's `=<`, `=>`, `(.)`."""

    def fake_llm(system, user):
        return json.dumps(
            [
                {
                    "endpoint": "/company/search",
                    "track": "design_partner",
                    "payload": {
                        "filters": {
                            "op": "and",
                            "conditions": [
                                {"field": "headcount.total", "type": "<=", "value": 500},
                                {"field": "headcount.total", "type": ">=", "value": 50},
                                {
                                    "op": "or",
                                    "conditions": [
                                        {"field": "title", "type": "=~", "value": "Partner|GP"},
                                    ],
                                },
                            ],
                        }
                    },
                    "rationale": "r",
                }
            ]
        )

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    conds = plans[0].payload["filters"]["conditions"]
    assert conds[0]["type"] == "=<"
    assert conds[1]["type"] == "=>"
    assert conds[2]["conditions"][0]["type"] == "(.)"


def test_query_planner_normalizes_sort_key_per_endpoint(thesis):
    """Crustdata is inconsistent: `/company/search` wants `column`, while
    `/person/search` wants `field`. Normalize per endpoint so the LLM's
    arbitrary choice doesn't 400."""

    def fake_llm(system, user):
        return json.dumps(
            [
                {
                    "endpoint": "/company/search",
                    "track": "design_partner",
                    "payload": {
                        "filters": {"op": "and", "conditions": []},
                        "sorts": [
                            {"field": "funding.total_investment_usd", "order": "desc"},
                        ],
                    },
                    "rationale": "r",
                },
                {
                    "endpoint": "/person/search",
                    "track": "talent",
                    "payload": {
                        "filters": {"op": "and", "conditions": []},
                        "sorts": [
                            {"column": "professional_network.connections", "order": "desc"},
                        ],
                    },
                    "rationale": "r",
                },
            ]
        )

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    company_sort = plans[0].payload["sorts"][0]
    person_sort = plans[1].payload["sorts"][0]
    assert "column" in company_sort and "field" not in company_sort
    assert "field" in person_sort and "column" not in person_sort


def test_query_planner_expands_in_range_to_paired_gte_lte(thesis):
    """`type: "in", value: [50, 500]` on a numeric field means a range.
    Crustdata has no `in` operator — split into `=>` and `=<`."""

    def fake_llm(system, user):
        return json.dumps(
            [
                {
                    "endpoint": "/company/search",
                    "track": "design_partner",
                    "payload": {
                        "filters": {
                            "op": "and",
                            "conditions": [
                                {"field": "headcount.total", "type": "in", "value": [50, 500]},
                            ],
                        }
                    },
                    "rationale": "r",
                }
            ]
        )

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    conds = plans[0].payload["filters"]["conditions"]
    # original `in` replaced by two paired conditions
    ops_values = sorted((c["type"], c["value"]) for c in conds)
    assert ops_values == [("=<", 500), ("=>", 50)]


def test_query_planner_drops_conditions_with_null_values(thesis):
    """`is_not_null` / null-valued conditions are not supported by Crustdata —
    drop them silently rather than emitting a request that 400s."""

    def fake_llm(system, user):
        return json.dumps(
            [
                {
                    "endpoint": "/company/search",
                    "track": "design_partner",
                    "payload": {
                        "filters": {
                            "op": "and",
                            "conditions": [
                                {"field": "taxonomy.professional_network_industry", "type": "=", "value": "Logistics"},
                                {"field": "funding.last_round_type", "type": "is_not_null", "value": None},
                            ],
                        }
                    },
                    "rationale": "r",
                }
            ]
        )

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    conds = plans[0].payload["filters"]["conditions"]
    assert len(conds) == 1
    assert conds[0]["field"] == "taxonomy.professional_network_industry"


def test_query_planner_converts_list_on_bracket_dot_to_in(thesis):
    """`[.]` (exact-token) with a list value is rejected by Crustdata —
    only `in` / `not_in` accept lists. Convert `[.]+list` → `in+list`."""

    def fake_llm(system, user):
        return json.dumps(
            [
                {
                    "endpoint": "/person/search",
                    "track": "investor",
                    "payload": {
                        "filters": {
                            "op": "and",
                            "conditions": [
                                {"field": "experience.employment_details.company_name",
                                 "type": "[.]", "value": ["Sequoia", "Accel"]},
                                {"field": "experience.employment_details.title",
                                 "type": "(.)", "value": ["Partner", "Principal"]},
                            ],
                        }
                    },
                    "rationale": "r",
                }
            ]
        )

    plans = QueryPlanner(llm=fake_llm).plan(thesis)
    conds = plans[0].payload["filters"]["conditions"]
    # `[.]` + list → `in` + same list
    assert conds[0]["type"] == "in"
    assert conds[0]["value"] == ["Sequoia", "Accel"]
    # `(.)` + list → OR-group of single-term `(.)` conditions.
    # (Crustdata's `(.)` is fuzzy substring, not regex — pipes match literally,
    # so a pipe-joined alternation would return zero results.)
    assert conds[1] == {
        "op": "or",
        "conditions": [
            {"field": "experience.employment_details.title", "type": "(.)", "value": "Partner"},
            {"field": "experience.employment_details.title", "type": "(.)", "value": "Principal"},
        ],
    }


def test_query_planner_system_prompt_contains_filter_schema(thesis):
    captured: dict[str, str] = {}

    def fake_llm(system, user):
        captured["system"] = system
        return json.dumps(SAMPLE_PLAN)

    QueryPlanner(llm=fake_llm).plan(thesis)
    assert "geo_distance" in captured["system"]
    assert "/person/search" in captured["system"]
    assert "/company/search" in captured["system"]
    assert "/web/search/live" in captured["system"]
