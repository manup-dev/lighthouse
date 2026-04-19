"""Gallery endpoint: serves pre-baked MatchResult fixtures so visitors see
credible sample output while their own pipeline run is queued."""

from __future__ import annotations

import json

import httpx
import pytest
from httpx import ASGITransport


@pytest.fixture
def gallery_app(tmp_path, monkeypatch):
    fixtures = tmp_path / "gallery"
    fixtures.mkdir()
    (fixtures / "qdrant.json").write_text(
        json.dumps(
            {
                "slug": "qdrant",
                "display_name": "Qdrant",
                "tagline": "Vector search engine",
                "why": "AI infra darling",
                "baked_at": 123.0,
                "result": {
                    "repo_url": "https://github.com/qdrant/qdrant",
                    "thesis": {"moat": "m", "themes": [], "icp": {}, "ideal_hire": {}},
                    "query_plan": [],
                    "investors": [{}, {}],
                    "design_partners": [{}],
                    "talent": [{}, {}, {}],
                    "stats": {},
                },
            }
        )
    )

    from lighthouse import api as api_module

    monkeypatch.setattr(api_module, "_GALLERY_DIR", fixtures)
    return api_module.app


async def test_list_returns_baked_items_with_counts(gallery_app):
    async with httpx.AsyncClient(
        transport=ASGITransport(app=gallery_app), base_url="http://test"
    ) as c:
        resp = await c.get("/gallery")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["slug"] == "qdrant"
    assert item["display_name"] == "Qdrant"
    assert item["counts"] == {"investors": 2, "design_partners": 1, "talent": 3}
    assert item["repo_url"] == "https://github.com/qdrant/qdrant"


async def test_get_returns_full_envelope(gallery_app):
    async with httpx.AsyncClient(
        transport=ASGITransport(app=gallery_app), base_url="http://test"
    ) as c:
        resp = await c.get("/gallery/qdrant")
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "qdrant"
    assert data["result"]["repo_url"] == "https://github.com/qdrant/qdrant"


async def test_get_rejects_bad_slug(gallery_app):
    async with httpx.AsyncClient(
        transport=ASGITransport(app=gallery_app), base_url="http://test"
    ) as c:
        resp = await c.get("/gallery/../../etc/passwd")
    assert resp.status_code in (400, 404)


async def test_get_missing_slug_returns_404(gallery_app):
    async with httpx.AsyncClient(
        transport=ASGITransport(app=gallery_app), base_url="http://test"
    ) as c:
        resp = await c.get("/gallery/does-not-exist")
    assert resp.status_code == 404
