"""Tests for the Lighthouse MCP stdio server."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from mcp.types import TextContent

from lighthouse import mcp_server
from lighthouse.cli import _DryRunCrust
from lighthouse.models import MatchResult, Thesis


def _canned_match_result() -> MatchResult:
    """Build a minimal valid MatchResult for use in stubs."""
    return MatchResult(
        repo_url="x",
        thesis=Thesis(
            moat="canned moat",
            themes=["t1"],
            icp={"industry": "logistics"},
            ideal_hire={"role": "Staff Engineer"},
        ),
        query_plan=[],
        investors=[
            {
                "name": "Investor A",
                "title": "Partner",
                "company": "Fund",
                "linkedin": "https://linkedin.com/in/a",
                "score": 90.0,
                "sub_scores": {"a": 50.0, "b": 40.0},
                "warm_intro_draft": "Hi A",
            }
        ],
        design_partners=[],
        talent=[],
        stats={"duration_sec": 0.01},
    )


async def test_mcp_server_exposes_investors_tool():
    server = mcp_server.build_server()
    tools = await server._lighthouse_list_tools()

    names = {t.name for t in tools}
    assert "lighthouse_investors_for_repo" in names
    investors_tool = next(t for t in tools if t.name == "lighthouse_investors_for_repo")
    assert "repo_url" in investors_tool.inputSchema["required"]
    assert investors_tool.inputSchema["properties"]["repo_url"]["type"] == "string"
    assert investors_tool.description  # non-empty


async def test_mcp_server_exposes_candidates_for_jd_tool():
    server = mcp_server.build_server()
    tools = await server._lighthouse_list_tools()

    names = {t.name for t in tools}
    assert "lighthouse_candidates_for_jd" in names
    jd_tool = next(t for t in tools if t.name == "lighthouse_candidates_for_jd")
    assert "jd" in jd_tool.inputSchema["required"]
    assert jd_tool.description  # non-empty


async def test_mcp_server_candidates_for_jd_runs_matcher_and_returns_people(monkeypatch):
    from lighthouse.models import MatchedPerson

    canned = [
        MatchedPerson(
            name="Staff Eng J",
            title="Staff Engineer",
            company="Delhivery",
            linkedin="https://linkedin.com/in/j",
            score=92.0,
            sub_scores={"role_fit": 50.0, "signal": 42.0},
            warm_intro_draft="Hi J — saw your dispatch post.",
        )
    ]

    fake_matcher = AsyncMock()
    fake_matcher.match = AsyncMock(return_value=canned)

    def fake_matcher_builder(llm, crust):
        return fake_matcher

    monkeypatch.setattr(mcp_server, "_build_jd_matcher", fake_matcher_builder)
    monkeypatch.setattr(mcp_server, "make_llm", lambda *a, **kw: object())
    monkeypatch.setattr(mcp_server, "_build_crust", lambda: object())

    server = mcp_server.build_server()
    result = await server._lighthouse_call_tool(
        "lighthouse_candidates_for_jd",
        {"jd": "Staff backend engineer at freight startup", "location": "Bangalore"},
    )

    assert len(result) == 1
    parsed = json.loads(result[0].text)
    assert isinstance(parsed, dict)
    assert "candidates" in parsed
    assert len(parsed["candidates"]) == 1
    assert parsed["candidates"][0]["name"] == "Staff Eng J"

    fake_matcher.match.assert_awaited_once()
    call_kwargs = fake_matcher.match.await_args.kwargs
    assert call_kwargs.get("jd", "").startswith("Staff backend")
    assert call_kwargs.get("location") == "Bangalore"


async def test_mcp_server_tool_call_returns_match_result_json(monkeypatch):
    canned = _canned_match_result()

    fake_pipeline = AsyncMock()
    fake_pipeline.run = AsyncMock(return_value=canned)

    def fake_builder(llm, crust):
        return fake_pipeline

    # avoid constructing a real LLM / crust client
    monkeypatch.setattr(mcp_server, "_build_pipeline", fake_builder)
    monkeypatch.setattr(mcp_server, "make_llm", lambda *a, **kw: object())
    monkeypatch.setattr(mcp_server, "_build_crust", lambda: object())

    server = mcp_server.build_server()
    result = await server._lighthouse_call_tool(
        "lighthouse_investors_for_repo", {"repo_url": "x"}
    )

    assert isinstance(result, list)
    assert len(result) == 1
    block = result[0]
    assert isinstance(block, TextContent)
    assert block.type == "text"

    parsed = json.loads(block.text)
    assert parsed["repo_url"] == "x"
    assert isinstance(parsed["investors"], list)
    assert len(parsed["investors"]) == 1
    assert parsed["investors"][0]["name"] == "Investor A"

    # and the pipeline was actually invoked with repo_url + default location
    fake_pipeline.run.assert_awaited_once()
    call_kwargs = fake_pipeline.run.await_args.kwargs
    call_args = fake_pipeline.run.await_args.args
    assert "x" in call_args or call_kwargs.get("repo_url") == "x"
    assert call_kwargs.get("location") == "Bangalore"


def test_mcp_server_uses_dry_run_crust_when_no_api_key(monkeypatch):
    monkeypatch.delenv("CRUSTDATA_API_KEY", raising=False)
    crust = mcp_server._build_crust()
    assert isinstance(crust, _DryRunCrust)
