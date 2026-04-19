from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from lighthouse.models import MatchedPerson
from lighthouse.thesis import _strip_fence

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "enricher.md"

_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$")
_BLOCKED_DOMAINS = {
    "linkedin.com", "www.linkedin.com",
    "google.com", "www.google.com",
    "twitter.com", "x.com",
    "medium.com",
    "youtube.com",
    "github.com",
}


def _coerce_domain(raw: str | None) -> str | None:
    """Normalise an LLM-suggested domain to a bare registrable host, or None."""
    if not raw or not isinstance(raw, str):
        return None
    d = raw.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/", 1)[0]
    d = d.strip(".")
    if not d or not _DOMAIN_RE.match(d):
        return None
    if d in _BLOCKED_DOMAINS:
        return None
    return d


def _logo_url(domain: str | None) -> str | None:
    if not domain:
        return None
    return f"https://logo.clearbit.com/{domain}"


class Enricher:
    """Uses an LLM to normalise candidate records + derive a logo URL.

    The same prompt works for all three tracks (investor / design_partner /
    talent) so the UI stops rendering "?" avatars and page-title-as-name cards.
    """

    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def enrich_one(self, person: MatchedPerson, track: str) -> MatchedPerson:
        payload = {
            "track": track,
            "name": person.name,
            "title": person.title,
            "company": person.company,
            "linkedin": person.linkedin,
            "recent_post": person.recent_post,
            "recent_post_url": person.recent_post_url,
        }
        try:
            raw = self._llm(self._system, json.dumps(payload))
        except Exception:
            return person
        cleaned = _strip_fence(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return person
        if not isinstance(data, dict):
            return person

        updates: dict = {}

        kind = data.get("kind")
        clean_name = data.get("name")
        firm = data.get("firm")
        domain = _coerce_domain(data.get("domain"))

        if kind == "organization" and isinstance(clean_name, str) and clean_name.strip():
            # Org-kind rows usually have a page title leaked into `name` —
            # overwrite with the LLM's short form. For person-kind, the
            # original name is authoritative and we never touch it.
            updates["name"] = clean_name.strip()

        if isinstance(firm, str) and firm.strip():
            current = (person.company or "").strip()
            if not current:
                updates["company"] = firm.strip()

        logo = _logo_url(domain)
        if logo:
            updates["logo_url"] = logo

        if not updates:
            return person
        return person.model_copy(update=updates)

    def enrich(
        self, by_track: dict[str, list[MatchedPerson]]
    ) -> dict[str, list[MatchedPerson]]:
        out: dict[str, list[MatchedPerson]] = {}
        for track, people in by_track.items():
            out[track] = [self.enrich_one(p, track) for p in people]
        return out
