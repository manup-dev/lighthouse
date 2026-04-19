from __future__ import annotations

import json
from pathlib import Path

from lighthouse.models import MatchedPerson, Thesis
from lighthouse.thesis import LLM, _strip_fence

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "outreach.md"


class OutreachDrafter:
    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def draft(
        self,
        thesis: Thesis,
        by_track: dict[str, list[MatchedPerson]],
    ) -> dict[str, list[MatchedPerson]]:
        people_payload: list[dict] = []
        for track, people in by_track.items():
            for idx, person in enumerate(people):
                people_payload.append(
                    {
                        "id": f"{track}_{idx}",
                        "track": track,
                        "name": person.name,
                        "title": person.title,
                        "company": person.company,
                        "recent_post": person.recent_post,
                        "recent_post_date": person.recent_post_date,
                        "recent_post_url": person.recent_post_url,
                    }
                )

        user_payload = {"thesis": thesis.model_dump(), "people": people_payload}
        raw = self._llm(self._system, json.dumps(user_payload))
        cleaned = _strip_fence(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"OutreachDrafter: invalid JSON: {exc}") from exc
        drafts: dict[str, str] = data.get("drafts", {}) or {}

        out: dict[str, list[MatchedPerson]] = {}
        for track, people in by_track.items():
            out[track] = []
            for idx, person in enumerate(people):
                key = f"{track}_{idx}"
                draft = drafts.get(key, "")
                updated = person.model_copy(update={"warm_intro_draft": draft})
                out[track].append(updated)
        return out
