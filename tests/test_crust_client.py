import json
from pathlib import Path

import httpx
import pytest

from lighthouse.crust_client import CrustClient
from lighthouse.models import CrustQueryPlan

BASE = "https://api.crustdata.com"


@pytest.fixture
def client(tmp_path):
    return CrustClient(api_key="test-key", cache_dir=tmp_path / "cache", retry_base_delay=0.0)


async def test_person_search_posts_to_correct_endpoint(client, respx_mock):
    route = respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": [{"name": "Jane"}], "next_cursor": None})
    )
    payload = {"filters": {"op": "and", "conditions": []}, "limit": 50}

    data = await client.person_search(payload)

    assert data["results"][0]["name"] == "Jane"
    assert route.called
    sent = json.loads(route.calls[0].request.content)
    assert sent == payload


async def test_company_search_posts_to_correct_endpoint(client, respx_mock):
    route = respx_mock.post(f"{BASE}/company/search").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    await client.company_search({"filters": {"op": "and", "conditions": []}})
    assert route.called


async def test_web_search_live_posts_to_correct_endpoint(client, respx_mock):
    route = respx_mock.post(f"{BASE}/web/search/live").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    await client.web_search_live({"query": "logistics routing", "time_range": "14d"})
    assert route.called


async def test_requests_send_auth_and_version_headers(client, respx_mock):
    route = respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    await client.person_search({"filters": {}})
    headers = route.calls[0].request.headers
    assert headers["authorization"] == "Bearer test-key"
    assert headers["x-api-version"] == "2025-11-01"
    assert headers["content-type"].startswith("application/json")


async def test_company_identify_posts_name(client, respx_mock):
    route = respx_mock.post(f"{BASE}/company/identify").mock(
        return_value=httpx.Response(200, json={"company_id": "c_123"})
    )
    data = await client.company_identify("Anthropic")
    assert data["company_id"] == "c_123"
    body = json.loads(route.calls[0].request.content)
    assert body == {"name": "Anthropic"}


async def test_person_enrich_batches_urls(client, respx_mock):
    route = respx_mock.post(f"{BASE}/person/enrich").mock(
        return_value=httpx.Response(200, json={"enriched": [{"url": "a"}, {"url": "b"}]})
    )
    urls = ["https://linkedin.com/in/a", "https://linkedin.com/in/b"]
    await client.person_enrich(urls)
    body = json.loads(route.calls[0].request.content)
    assert body == {"professional_network_profile_urls": urls}


async def test_429_retries_with_backoff(client, respx_mock):
    route = respx_mock.post(f"{BASE}/person/search").mock(
        side_effect=[
            httpx.Response(429, json={"error": "rate limit"}),
            httpx.Response(429, json={"error": "rate limit"}),
            httpx.Response(200, json={"results": [{"name": "Ok"}]}),
        ]
    )
    data = await client.person_search({"filters": {}})
    assert data["results"][0]["name"] == "Ok"
    assert route.call_count == 3


async def test_429_gives_up_after_max_retries(respx_mock, tmp_path):
    c = CrustClient(api_key="k", cache_dir=tmp_path / "cache", retry_base_delay=0.0, max_retries=2)
    respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(429, json={"error": "rate limit"})
    )
    with pytest.raises(httpx.HTTPStatusError):
        await c.person_search({"filters": {}})


async def test_500_raises_immediately_without_retry(client, respx_mock):
    route = respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    with pytest.raises(httpx.HTTPStatusError):
        await client.person_search({"filters": {}})
    assert route.call_count == 1


async def test_cache_hit_skips_http_call(client, respx_mock):
    respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": [{"name": "cached"}]})
    )
    payload = {"filters": {"op": "and", "conditions": []}}

    first = await client.person_search(payload)
    second = await client.person_search(payload)

    assert first == second
    assert respx_mock.calls.call_count == 1


async def test_cache_disabled_when_cache_dir_none(tmp_path, respx_mock):
    c = CrustClient(api_key="k", cache_dir=None, retry_base_delay=0.0)
    respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    payload = {"filters": {}}
    await c.person_search(payload)
    await c.person_search(payload)
    assert respx_mock.calls.call_count == 2


async def test_fan_out_routes_plans_to_correct_endpoints(client, respx_mock):
    respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": [{"name": "P"}]})
    )
    respx_mock.post(f"{BASE}/company/search").mock(
        return_value=httpx.Response(200, json={"results": [{"name": "C"}]})
    )
    respx_mock.post(f"{BASE}/web/search/live").mock(
        return_value=httpx.Response(200, json={"results": [{"url": "u"}]})
    )
    plans = [
        CrustQueryPlan(endpoint="/person/search", track="investor", payload={"filters": {}}, rationale="r1"),
        CrustQueryPlan(endpoint="/company/search", track="design_partner", payload={"filters": {}}, rationale="r2"),
        CrustQueryPlan(endpoint="/web/search/live", track="talent", payload={"query": "q", "time_range": "14d"}, rationale="r3"),
    ]

    results = await client.fan_out(plans)

    assert len(results) == 3
    by_track = {r["track"]: r for r in results}
    assert by_track["investor"]["response"]["results"][0]["name"] == "P"
    assert by_track["design_partner"]["response"]["results"][0]["name"] == "C"
    assert by_track["talent"]["response"]["results"][0]["url"] == "u"


async def test_fan_out_invokes_progress_callbacks_per_query(client, respx_mock):
    respx_mock.post(f"{BASE}/person/search").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    respx_mock.post(f"{BASE}/company/search").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    plans = [
        CrustQueryPlan(endpoint="/person/search", track="investor", payload={"filters": {}}, rationale="r1"),
        CrustQueryPlan(endpoint="/company/search", track="design_partner", payload={"filters": {}}, rationale="r2"),
    ]
    started: list[tuple[int, str]] = []
    finished: list[tuple[int, str, bool]] = []

    await client.fan_out(
        plans,
        on_start=lambda i, p: started.append((i, p.endpoint)),
        on_finish=lambda i, p, r, err: finished.append((i, p.endpoint, err is None)),
    )

    assert len(started) == 2
    assert len(finished) == 2
    assert {s[1] for s in started} == {"/person/search", "/company/search"}


def test_dedup_people_by_linkedin_url():
    from lighthouse.crust_client import dedup_people

    people = [
        {"name": "A", "linkedin": "https://linkedin.com/in/a"},
        {"name": "A2", "linkedin": "https://linkedin.com/in/a"},
        {"name": "B", "linkedin": "https://linkedin.com/in/b"},
        {"name": "C", "linkedin": None},
        {"name": "C2", "linkedin": None},
    ]
    out = dedup_people(people)
    assert len(out) == 4  # two 'a' collapse, two None-linkedin kept (falsy keys keep all)
    names = [p["name"] for p in out]
    assert "A" in names and "A2" not in names
    assert "B" in names
    assert names.count("C") + names.count("C2") == 2
