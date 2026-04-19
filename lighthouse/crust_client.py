from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

from lighthouse.models import CrustQueryPlan

BASE_URL = "https://api.crustdata.com"
API_VERSION = "2025-11-01"


def _cache_key(endpoint: str, payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _slug(endpoint: str) -> str:
    return endpoint.strip("/").replace("/", "_")


class CrustClient:
    def __init__(
        self,
        api_key: str,
        cache_dir: Path | None = None,
        base_url: str = BASE_URL,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_base_delay: float = 0.5,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_base_delay = retry_base_delay
        self._cache_dir = Path(cache_dir) if cache_dir else None
        self._headers = {
            "authorization": f"Bearer {api_key}",
            "x-api-version": API_VERSION,
            "content-type": "application/json",
        }

    async def person_search(self, payload: dict) -> dict:
        return await self._post("/person/search", payload)

    async def person_enrich(self, urls: list[str]) -> dict:
        return await self._post("/person/enrich", {"professional_network_profile_urls": urls})

    async def company_search(self, payload: dict) -> dict:
        return await self._post("/company/search", payload)

    async def company_enrich(self, company_ids: list[str]) -> dict:
        return await self._post("/company/enrich", {"company_ids": company_ids})

    async def company_identify(self, name: str) -> dict:
        return await self._post("/company/identify", {"name": name})

    async def web_search_live(self, payload: dict) -> dict:
        return await self._post("/web/search/live", payload)

    async def fan_out(self, plans: list[CrustQueryPlan]) -> list[dict[str, Any]]:
        tasks = [self._post(p.endpoint, p.payload) for p in plans]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        out: list[dict[str, Any]] = []
        for plan, resp in zip(plans, responses):
            out.append(
                {
                    "track": plan.track,
                    "endpoint": plan.endpoint,
                    "rationale": plan.rationale,
                    "response": resp if not isinstance(resp, Exception) else None,
                    "error": str(resp) if isinstance(resp, Exception) else None,
                }
            )
        return out

    async def _post(self, endpoint: str, payload: dict) -> dict:
        cached = self._cache_read(endpoint, payload)
        if cached is not None:
            return cached
        url = f"{self._base_url}{endpoint}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for attempt in range(self._max_retries + 1):
                resp = await client.post(url, json=payload, headers=self._headers)
                if resp.status_code == 429 and attempt < self._max_retries:
                    await asyncio.sleep(self._retry_base_delay * (2 ** attempt))
                    continue
                if resp.status_code >= 400:
                    # Surface the server's reason — Crustdata puts it in the body.
                    body = resp.text[:500]
                    raise httpx.HTTPStatusError(
                        f"{resp.status_code} {resp.reason_phrase} {endpoint} — {body}",
                        request=resp.request,
                        response=resp,
                    )
                data = resp.json()
                self._cache_write(endpoint, payload, data)
                return data
        raise RuntimeError("unreachable: retry loop exhausted without raising")

    def _cache_path(self, endpoint: str, payload: dict) -> Path | None:
        if self._cache_dir is None:
            return None
        return self._cache_dir / _slug(endpoint) / f"{_cache_key(endpoint, payload)}.json"

    def _cache_read(self, endpoint: str, payload: dict) -> dict | None:
        path = self._cache_path(endpoint, payload)
        if path is None or not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def _cache_write(self, endpoint: str, payload: dict, data: dict) -> None:
        path = self._cache_path(endpoint, payload)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def dedup_people(people: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for person in people:
        key = person.get("linkedin")
        if not key:
            out.append(person)
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(person)
    return out
