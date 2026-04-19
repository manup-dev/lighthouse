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

    assert len(tools) == 1
    tool = tools[0]
    assert tool.name == "lighthouse_investors_for_repo"
    assert "repo_url" in tool.inputSchema["required"]
    assert tool.inputSchema["properties"]["repo_url"]["type"] == "string"
    assert tool.description  # non-empty


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
