from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from lighthouse.models import CrustQueryPlan, Thesis
from lighthouse.thesis import _strip_fence

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "query_planner.md"

_OPERATOR_FIXES = {
    "<=": "=<",
    ">=": "=>",
    "=~": "(.)",
    "~=": "(.)",
}

# Operators Crustdata has no equivalent for — the condition gets dropped.
_UNSUPPORTED_OPS = {"is_not_null", "is_null", "exists", "not_exists"}


def _expand_in_range(cond: dict) -> list[dict] | None:
    """If `cond` is `{type: "in", value: [lo, hi]}` on a numeric field, expand
    it to a pair of `=>` / `=<` conditions. Otherwise return None (leave as-is)."""
    if cond.get("type") != "in":
        return None
    value = cond.get("value")
    if not isinstance(value, list) or len(value) != 2:
        return None
    if not all(isinstance(v, (int, float)) for v in value):
        return None
    lo, hi = sorted(value)
    field = cond.get("field")
    return [
        {"field": field, "type": "=>", "value": lo},
        {"field": field, "type": "=<", "value": hi},
    ]


def _coerce_list_value(cond: dict) -> None:
    """Crustdata accepts list values only on `in` / `not_in`.

    - `[.]` + list → `in` + list
    - `(.)` + list of strings → `(.)` + `"A|B|C"` (fuzzy regex alternation)
    - Any other op + list → promote to `in`
    """
    value = cond.get("value")
    if not isinstance(value, list):
        return
    op = cond.get("type")
    if op in ("in", "not_in"):
        return
    if op == "(.)" and all(isinstance(v, str) for v in value):
        cond["value"] = "|".join(value)
        return
    # default: promote to `in`
    cond["type"] = "in"


def _sanitize_conditions(conditions: list) -> list:
    """Filter / expand a conditions list in one pass."""
    out: list = []
    for cond in conditions:
        if not isinstance(cond, dict):
            out.append(cond)
            continue
        # Nested boolean group — recurse.
        if "conditions" in cond:
            cond["conditions"] = _sanitize_conditions(cond["conditions"])
            out.append(cond)
            continue
        op = cond.get("type")
        # Drop null-valued conditions — Crustdata requires a typed value.
        if op in _UNSUPPORTED_OPS or cond.get("value") is None:
            continue
        expanded = _expand_in_range(cond)
        if expanded is not None:
            out.extend(expanded)
            continue
        _coerce_list_value(cond)
        out.append(cond)
    return out


def _normalize_sorts(payload, endpoint: str | None = None) -> None:
    """Rename `sorts[*].field` ↔ `sorts[*].column` depending on endpoint.

    Crustdata is inconsistent: `/company/search` expects `column`, while
    `/person/search` expects `field`. We normalise to whichever the endpoint
    wants so the LLM's arbitrary choice doesn't blow up the request."""
    if not isinstance(payload, dict):
        return
    sorts = payload.get("sorts")
    if not isinstance(sorts, list):
        return
    target_key = "column" if endpoint == "/company/search" else "field"
    other_key = "field" if target_key == "column" else "column"
    for entry in sorts:
        if isinstance(entry, dict) and other_key in entry and target_key not in entry:
            entry[target_key] = entry.pop(other_key)


def _normalize_operators(node):
    """Walk the filter tree and fix common LLM operator mistakes in-place."""
    if isinstance(node, dict):
        op = node.get("type")
        if isinstance(op, str) and op in _OPERATOR_FIXES:
            node["type"] = _OPERATOR_FIXES[op]
        if isinstance(node.get("conditions"), list):
            node["conditions"] = _sanitize_conditions(node["conditions"])
        for value in node.values():
            _normalize_operators(value)
    elif isinstance(node, list):
        for item in node:
            _normalize_operators(item)
    return node


class QueryPlanner:
    def __init__(self, llm: LLM):
        self._llm = llm
        self._system = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

    def plan(
        self,
        thesis: Thesis,
        location: str | None = None,
        user_hint: str | None = None,
    ) -> list[CrustQueryPlan]:
        user_payload: dict = {
            "thesis": thesis.model_dump(),
            "location": location,
        }
        if user_hint:
            user_payload["user_hint"] = user_hint
        raw = self._llm(self._system, json.dumps(user_payload))
        cleaned = _strip_fence(raw)
        try:
            items = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"QueryPlanner: LLM did not return valid JSON: {exc}") from exc
        if not isinstance(items, list):
            raise ValueError(f"QueryPlanner: expected JSON array, got {type(items).__name__}")
        for item in items:
            payload = item.get("payload")
            _normalize_operators(payload)
            _normalize_sorts(payload, item.get("endpoint"))
        return [CrustQueryPlan(**item) for item in items]
