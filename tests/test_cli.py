import json
from unittest.mock import patch

from typer.testing import CliRunner

from lighthouse.cli import app


runner = CliRunner()


def test_cli_match_dry_run_prints_funnel(tmp_path, monkeypatch):
    monkeypatch.delenv("CRUSTDATA_API_KEY", raising=False)
    with patch("lighthouse.cli.make_llm", return_value=_fake_llm()):
        result = runner.invoke(app, ["tests/fixtures/repos/demo_repo", "--dry-run", "--location", "Bangalore"])

    assert result.exit_code == 0, result.output
    assert "Investors" in result.output
    assert "Design Partners" in result.output
    assert "Talent" in result.output


def test_cli_match_json_flag_emits_parseable_match_result(monkeypatch):
    monkeypatch.delenv("CRUSTDATA_API_KEY", raising=False)
    with patch("lighthouse.cli.make_llm", return_value=_fake_llm()):
        result = runner.invoke(app, ["tests/fixtures/repos/demo_repo", "--dry-run", "--json"])

    assert result.exit_code == 0, result.output
    # the JSON is printed; extract the JSON block after the last "PIPELINE_JSON:" marker
    marker = "PIPELINE_JSON:"
    assert marker in result.output
    payload_block = result.output.split(marker, 1)[1].strip()
    data = json.loads(payload_block)
    assert data["repo_url"] == "tests/fixtures/repos/demo_repo"
    assert "thesis" in data
    assert "investors" in data


def test_cli_match_without_api_key_and_without_dry_run_errors(monkeypatch):
    monkeypatch.delenv("CRUSTDATA_API_KEY", raising=False)
    result = runner.invoke(app, ["tests/fixtures/repos/demo_repo"])
    assert result.exit_code != 0
    assert "CRUSTDATA_API_KEY" in result.output


def _fake_llm():
    """Build a fake LLM that answers every prompt type used by the pipeline."""

    def fake(system: str, user: str) -> str:
        sys_lower = system.lower()
        if "venture thesis analyst" in sys_lower:
            return json.dumps(
                {
                    "moat": "Sub-30-second vehicle routing for tier-2 freight fleets.",
                    "themes": ["routing", "logistics"],
                    "icp": {"industry": "logistics", "size_range": "50-500", "signal_keywords": ["dispatch"]},
                    "ideal_hire": {"role": "Staff Engineer", "seniority": "staff", "prior_employer_signals": ["logistics"]},
                }
            )
        if "crustdata-native" in sys_lower or "query payloads" in sys_lower:
            return json.dumps(
                [
                    {"endpoint": "/person/search", "track": "investor", "payload": {"filters": {}}, "rationale": "r"},
                    {"endpoint": "/company/search", "track": "design_partner", "payload": {"filters": {}}, "rationale": "r"},
                    {"endpoint": "/person/search", "track": "talent", "payload": {"filters": {}}, "rationale": "r"},
                ]
            )
        if "rank candidates" in sys_lower:
            data = json.loads(user)
            cands = data["candidates"]
            matches = [
                {
                    "name": c.get("name", "Unknown"),
                    "title": c.get("title", "Unknown"),
                    "company": c.get("company", "Unknown"),
                    "linkedin": c.get("linkedin"),
                    "recent_post": "they posted",
                    "recent_post_url": "https://example.com",
                    "recent_post_date": "2026-04-14",
                    "score": 85.0 - i,
                    "sub_scores": {"a": 30, "b": 55 - i},
                    "warm_intro_draft": "",
                }
                for i, c in enumerate(cands[:5])
            ]
            return json.dumps({"matches": matches, "requery": None})
        if "warm-intro" in sys_lower or "warm intro" in sys_lower:
            data = json.loads(user)
            drafts = {p["id"]: f"Hi {p['name']} — quick note." for p in data["people"]}
            return json.dumps({"drafts": drafts})
        raise AssertionError(f"unexpected prompt: {system[:60]!r}")

    return fake
