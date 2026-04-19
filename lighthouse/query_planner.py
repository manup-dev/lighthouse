from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from lighthouse.models import CrustQueryPlan, Thesis
from lighthouse.thesis import call_llm_for_json

LLM = Callable[[str, str], str]

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "query_planner.md"

_OPERATOR_FIXES = {
    "<=": "=<",
    ">=": "=>",
    "=~": "(.)",
    "~=": "(.)",
    # Python / JS habit — small LLMs (qwen 3B) reach for `==` even when the
    # prompt clearly says `=`. Crustdata rejects with 400 + full-schema error.
    "==": "=",
    "<>": "!=",
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


def _expand_fuzzy_multi(cond: dict) -> dict | None:
    """`(.)` is fuzzy substring match, NOT regex — pipes and other metacharacters
    match literally. If the LLM tried to use `(.)` with either a list of terms
    or a pipe-separated alternation string, rewrite it to an OR-group of
    single-term `(.)` conditions so each term actually matches."""
    if cond.get("type") != "(.)":
        return None
    value = cond.get("value")
    field = cond.get("field")
    terms: list[str]
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        terms = [v.strip() for v in value if v.strip()]
    elif isinstance(value, str) and "|" in value:
        terms = [t.strip() for t in value.split("|") if t.strip()]
    else:
        return None
    if len(terms) <= 1:
        if terms:
            cond["value"] = terms[0]
        return None
    return {
        "op": "or",
        "conditions": [
            {"field": field, "type": "(.)", "value": t} for t in terms
        ],
    }


def _coerce_list_value(cond: dict) -> None:
    """Crustdata accepts list values only on `in` / `not_in`.

    - `[.]` + list → `in` + list
    - Any other op + list → promote to `in`

    `(.)` + list is handled earlier by `_expand_fuzzy_multi` (it rewrites to an
    OR-group of single-term conditions), so by the time we get here we should
    not see it — but we defensively skip it anyway.
    """
    value = cond.get("value")
    if not isinstance(value, list):
        return
    op = cond.get("type")
    if op in ("in", "not_in", "(.)"):
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
        fuzzy_group = _expand_fuzzy_multi(cond)
        if fuzzy_group is not None:
            out.append(fuzzy_group)
            continue
        _coerce_list_value(cond)
        out.append(cond)
    return out


def _normalize_sorts(payload, endpoint: str | None = None) -> None:
    """Rename `sorts[*].field` ↔ `sorts[*].column` depending on endpoint.

    Crustdata is inconsistent: `/company/search` expects `column`, while
    `/person/search` expects `field`. We normalise to whichever the endpoint
    wants so the LLM's arbitrary choice doesn't blow up the request.

    Also defaults the required `order` field — smaller local LLMs (qwen 3B)
    frequently omit it, which Crustdata rejects as a 400. "desc" is the right
    default for the ranking use-cases the planner emits (recency, seniority).
    """
    if not isinstance(payload, dict):
        return
    sorts = payload.get("sorts")
    if not isinstance(sorts, list):
        return
    target_key = "column" if endpoint == "/company/search" else "field"
    other_key = "field" if target_key == "column" else "column"
    cleaned: list[dict] = []
    for entry in sorts:
        if not isinstance(entry, dict):
            continue
        if other_key in entry and target_key not in entry:
            entry[target_key] = entry.pop(other_key)
        if not entry.get(target_key):
            continue  # unusable sort — drop it instead of failing the request
        order = entry.get("order")
        if order not in ("asc", "desc"):
            entry["order"] = "desc"
        cleaned.append(entry)
    if cleaned:
        payload["sorts"] = cleaned
    else:
        payload.pop("sorts", None)


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


def _repair_filters_root(payload) -> bool:
    """Reshape payload['filters'] into a valid Crustdata compound (or drop it).

    Observed shapes from weaker LLMs that 400 at Crustdata:
      - `filters: [leaf1, leaf2]`     → wrap into `{op: "and", conditions: […]}`
      - `filters: {conditions: [..]}` → inject missing `op: "and"`
      - `filters: {field, type, value}` (leaf at root) → wrap in compound
      - `filters: {}` or other junk   → pop it (we don't fake a valid filter)

    Returns True if the payload is usable (has a valid compound filter or none),
    False if we had to strip the filter entirely — caller decides whether an
    unfiltered request is useful for the endpoint.
    """
    if not isinstance(payload, dict) or "filters" not in payload:
        return True
    filters = payload["filters"]

    if isinstance(filters, list):
        payload["filters"] = {"op": "and", "conditions": filters}
        return True

    if not isinstance(filters, dict):
        payload.pop("filters", None)
        return False

    if not filters:
        payload.pop("filters", None)
        return False

    # Compound: has `conditions`. Ensure op is present and valid.
    if "conditions" in filters:
        if filters.get("op") not in ("and", "or"):
            filters["op"] = "and"
        return True

    # Leaf at root: wrap in a compound so Crustdata's root parser accepts it.
    if "field" in filters and "type" in filters:
        payload["filters"] = {"op": "and", "conditions": [dict(filters)]}
        return True

    # Unrecognised shape — strip rather than risk a 400.
    payload.pop("filters", None)
    return False


def _extract_web_query(payload) -> str | None:
    """Derive a `query` string from a filter-shaped /web/search/live payload.

    Small LLMs sometimes build a filter tree for web search. Web search needs a
    single text query. Walk the payload and harvest every string value + list-
    of-strings value — the LLM put the thesis keywords in there somewhere.
    """
    if not isinstance(payload, dict):
        return None

    parts: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            v = node.get("value")
            if isinstance(v, str) and v.strip():
                parts.append(v.strip())
            elif isinstance(v, list):
                for x in v:
                    if isinstance(x, (str, int, float)):
                        s = str(x).strip()
                        if s:
                            parts.append(s)
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    # Dedupe, preserve first-seen order, cap length.
    seen: set[str] = set()
    kept: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            kept.append(p)
    if not kept:
        return None
    return " ".join(kept[:6])


def _repair_web_search(item) -> bool:
    """Coerce a /web/search/live item to the shape Crustdata requires.

    Returns True if the plan is usable after repair, False if no query text
    could be salvaged and the plan must be dropped.
    """
    payload = item.get("payload")
    if not isinstance(payload, dict):
        return False
    query = payload.get("query")
    if not (isinstance(query, str) and query.strip()):
        derived = _extract_web_query(payload)
        if not derived:
            return False
        payload["query"] = derived
    # Only `query` + `time_range` are valid on /web/search/live.
    for k in ("filters", "sorts", "limit"):
        payload.pop(k, None)
    payload.setdefault("time_range", "14d")
    return True


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
        items = call_llm_for_json(
            self._llm,
            self._system,
            json.dumps(user_payload),
            stage="QueryPlanner",
            expect="array",
        )
        repaired: list = []
        for item in items:
            if not isinstance(item, dict):
                continue
            payload = item.get("payload")
            if not isinstance(payload, dict):
                continue
            endpoint = item.get("endpoint")
            if endpoint == "/web/search/live":
                # Small LLMs sometimes build a filter tree here; salvage a query
                # from it or drop the plan rather than ship a guaranteed-400.
                if _repair_web_search(item):
                    repaired.append(item)
                continue
            # Filter-based endpoints. Reshape root first so downstream walkers
            # see a valid compound, then apply per-condition normalisation.
            _repair_filters_root(payload)
            _normalize_operators(payload)
            _normalize_sorts(payload, endpoint)
            repaired.append(item)
        return [CrustQueryPlan(**item) for item in repaired]
