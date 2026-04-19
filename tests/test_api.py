import asyncio
import json

import httpx
import pytest
from httpx import ASGITransport


def _build_fake_llm():
    def fake(system: str, user: str) -> str:
        sys_lower = system.lower()
        if "venture thesis analyst" in sys_lower:
            return json.dumps(
                {
                    "moat": "Sub-30-second routing.",
                    "themes": ["routing"],
                    "icp": {"industry": "logistics"},
                    "ideal_hire": {"role": "Staff Engineer"},
                }
            )
        if "crustdata-native" in sys_lower:
            return json.dumps(
                [
                    {"endpoint": "/person/search", "track": "investor", "payload": {}, "rationale": "r"},
                    {"endpoint": "/company/search", "track": "design_partner", "payload": {}, "rationale": "r"},
                    {"endpoint": "/person/search", "track": "talent", "payload": {}, "rationale": "r"},
                ]
            )
        if "rank candidates" in sys_lower:
            data = json.loads(user)
            matches = [
                {
                    "name": c.get("name", f"N{i}"),
                    "title": c.get("title", "X"),
                    "company": c.get("company", "Y"),
                    "linkedin": c.get("linkedin"),
                    "recent_post": "they posted",
                    "recent_post_url": "https://example.com",
                    "recent_post_date": "2026-04-14",
                    "score": 85.0 - i,
                    "sub_scores": {"a": 30},
                    "warm_intro_draft": "",
                }
                for i, c in enumerate(data["candidates"][:5])
            ]
            return json.dumps({"matches": matches, "requery": None})
        if "clean up messy candidate records" in sys_lower:
            data = json.loads(user)
            return json.dumps(
                {
                    "kind": "person" if data.get("linkedin") else "organization",
                    "name": data.get("name") or data.get("company") or "",
                    "firm": data.get("company") or data.get("name") or "",
                    "domain": "",
                }
            )
        if "warm-intro" in sys_lower or "warm intro" in sys_lower:
            data = json.loads(user)
            drafts = {p["id"]: f"hi {p['name']}" for p in data["people"]}
            return json.dumps({"drafts": drafts})
        raise AssertionError(f"unexpected prompt: {system[:60]!r}")

    return fake


@pytest.fixture
def api_app(monkeypatch):
    # Force dry-run crust + fake LLM inside the server
    monkeypatch.delenv("CRUSTDATA_API_KEY", raising=False)
    monkeypatch.setattr("lighthouse.api.make_llm", lambda: _build_fake_llm())

    from lighthouse.api import app

    return app


async def _post_match(client, body):
    resp = await client.post("/match", json=body)
    return resp


async def test_post_match_returns_match_id(api_app):
    async with httpx.AsyncClient(transport=ASGITransport(app=api_app), base_url="http://test") as c:
        resp = await c.post("/match", json={"repo_url": "tests/fixtures/repos/demo_repo"})
    assert resp.status_code == 200
    data = resp.json()
    assert "match_id" in data and len(data["match_id"]) > 0


async def test_get_events_emits_stage_and_result(api_app):
    async with httpx.AsyncClient(transport=ASGITransport(app=api_app), base_url="http://test", timeout=30.0) as c:
        created = await c.post("/match", json={"repo_url": "tests/fixtures/repos/demo_repo"})
        mid = created.json()["match_id"]

        stages: list[str] = []
        result_payload: dict | None = None
        async with c.stream("GET", f"/match/{mid}/events") as stream:
            current_event = None
            async for line in stream.aiter_lines():
                if not line:
                    continue
                if line.startswith("event:"):
                    current_event = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data_str = line.split(":", 1)[1].strip()
                    if current_event == "stage":
                        stages.append(json.loads(data_str)["stage"])
                    elif current_event == "result":
                        result_payload = json.loads(data_str)
                        break

        assert "analyzer" in stages
        assert "pipeline" in stages
        assert result_payload is not None
        assert result_payload["repo_url"] == "tests/fixtures/repos/demo_repo"
        assert len(result_payload["investors"]) >= 1


async def test_get_events_includes_log_events(api_app):
    """SSE stream must surface `log` events alongside stage/result."""
    async with httpx.AsyncClient(transport=ASGITransport(app=api_app), base_url="http://test", timeout=30.0) as c:
        created = await c.post("/match", json={"repo_url": "tests/fixtures/repos/demo_repo"})
        mid = created.json()["match_id"]

        log_messages: list[str] = []
        async with c.stream("GET", f"/match/{mid}/events") as stream:
            current_event = None
            async for line in stream.aiter_lines():
                if not line:
                    continue
                if line.startswith("event:"):
                    current_event = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data_str = line.split(":", 1)[1].strip()
                    if current_event == "log":
                        log_messages.append(json.loads(data_str)["message"])
                    elif current_event == "result":
                        break

    assert len(log_messages) > 0
    joined = " | ".join(m.lower() for m in log_messages)
    assert "thesis" in joined
    assert "rank" in joined


async def test_get_events_for_unknown_match_id_returns_404(api_app):
    async with httpx.AsyncClient(transport=ASGITransport(app=api_app), base_url="http://test") as c:
        resp = await c.get("/match/does-not-exist/events")
    assert resp.status_code == 404


async def test_health_endpoint_reports_ok(api_app):
    async with httpx.AsyncClient(transport=ASGITransport(app=api_app), base_url="http://test") as c:
        resp = await c.get("/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
