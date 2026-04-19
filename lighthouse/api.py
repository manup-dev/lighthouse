from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from lighthouse.cli import _DryRunCrust
from lighthouse.crust_client import CrustClient
from lighthouse.llm import make_llm
from lighthouse.models import CrustQueryPlan, LogEvent, MatchResult, StageEvent
from lighthouse.pipeline import Pipeline, _extract_candidates
from lighthouse.run_queue import QueueFull, RunQueue

_REFINE_PROMPT_PATH = Path(__file__).parent / "prompts" / "refine_draft.md"
_GALLERY_DIR = Path(__file__).parent / "fixtures" / "gallery"

_DONE_SENTINEL = ("__done__", None)

# Single-GPU gate — one pipeline runs at a time; everyone else parks in the queue.
_MAX_QUEUE_DEPTH = int(os.environ.get("LIGHTHOUSE_QUEUE_MAX_DEPTH", "20"))
_ETA_SECONDS_PER_RUN = int(os.environ.get("LIGHTHOUSE_ETA_SEC", "60"))
_run_queue = RunQueue(max_depth=_MAX_QUEUE_DEPTH)


class MatchRequest(BaseModel):
    repo_url: str
    location: str | None = "Bangalore"
    user_hint: str | None = None


class RefinePerson(BaseModel):
    name: str
    title: str | None = None
    company: str | None = None
    track: str | None = None


class RefineRequest(BaseModel):
    draft: str
    hook: str | None = None
    instruction: str
    person: RefinePerson


@dataclass
class _Job:
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    task: asyncio.Task | None = None
    result: MatchResult | None = None
    error: str | None = None


_jobs: dict[str, _Job] = {}


def _build_crust() -> Any:
    api_key = os.environ.get("CRUSTDATA_API_KEY")
    if api_key:
        cache_dir = Path(os.environ.get("LIGHTHOUSE_CACHE_DIR", ".cache/crust"))
        return CrustClient(api_key=api_key, cache_dir=cache_dir)
    return _DryRunCrust()


from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    load_dotenv()
    yield


app = FastAPI(title="Lighthouse", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/match")
async def create_match(req: MatchRequest) -> dict[str, Any]:
    # Reject up-front if the queue is already full — client should fall back to
    # the gallery instead of opening an SSE stream that never emits.
    if _run_queue.depth() >= _MAX_QUEUE_DEPTH:
        raise HTTPException(
            status_code=503,
            detail={
                "reason": "queue_full",
                "depth": _run_queue.depth(),
                "max_depth": _MAX_QUEUE_DEPTH,
                "fallback": "gallery",
            },
        )

    match_id = uuid.uuid4().hex
    job = _Job()
    _jobs[match_id] = job

    llm = make_llm()
    crust = _build_crust()
    pipeline = Pipeline(llm=llm, crust=crust)

    def on_event(ev: StageEvent) -> None:
        job.queue.put_nowait(("stage", ev))

    def on_log(ev: LogEvent) -> None:
        job.queue.put_nowait(("log", ev))

    async def _poll_positions() -> None:
        # Wait briefly for slot() to register us, then emit position ticks
        # every second so the UI can render "you're #N, ~Xs".
        for _ in range(50):
            if _run_queue.position(match_id) >= 0:
                break
            await asyncio.sleep(0.05)
        try:
            while True:
                pos = _run_queue.position(match_id)
                if pos <= 0:  # running or gone → stop; caller emits running tick
                    return
                job.queue.put_nowait(
                    (
                        "queue",
                        {
                            "position": pos,
                            "depth": _run_queue.depth(),
                            "eta_sec": pos * _ETA_SECONDS_PER_RUN,
                        },
                    )
                )
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    async def run() -> None:
        poller = asyncio.create_task(_poll_positions())
        try:
            async with _run_queue.slot(match_id):
                poller.cancel()
                # Running now — tell the client their wait is over before the
                # pipeline starts pushing stage events.
                job.queue.put_nowait(
                    (
                        "queue",
                        {"position": 0, "depth": _run_queue.depth(), "eta_sec": 0},
                    )
                )
                result = await pipeline.run(
                    req.repo_url,
                    location=req.location,
                    on_event=on_event,
                    on_log=on_log,
                    user_hint=req.user_hint,
                )
                job.result = result
                job.queue.put_nowait(("result", result))
        except QueueFull as exc:
            job.queue.put_nowait(
                ("error", {"message": "queue_full", "depth": exc.depth})
            )
        except Exception as exc:  # noqa: BLE001
            job.error = str(exc)
            job.queue.put_nowait(("error", {"message": str(exc)}))
        finally:
            poller.cancel()
            job.queue.put_nowait(_DONE_SENTINEL)

    job.task = asyncio.create_task(run())
    return {
        "match_id": match_id,
        "queue": {
            "position": max(0, _run_queue.depth() - 1),
            "depth": _run_queue.depth(),
            "eta_sec": max(0, _run_queue.depth() - 1) * _ETA_SECONDS_PER_RUN,
        },
    }


def _extract_variants(raw: str) -> list[str]:
    # Accept raw JSON or JSON wrapped in markdown fences.
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Last-resort: grab the first { ... } block.
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        if not brace:
            raise
        parsed = json.loads(brace.group(0))
    variants = parsed.get("variants") if isinstance(parsed, dict) else None
    if not isinstance(variants, list):
        raise ValueError("model did not return a 'variants' list")
    out = [str(v).strip() for v in variants if str(v).strip()]
    if not out:
        raise ValueError("model returned empty variants")
    # Pad to 3 by duplicating if the model under-produced.
    while len(out) < 3:
        out.append(out[-1])
    return out[:3]


@app.post("/refine-draft")
async def refine_draft(req: RefineRequest) -> dict[str, Any]:
    if not req.draft.strip():
        raise HTTPException(status_code=400, detail="draft is empty")
    if not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is empty")

    system = _REFINE_PROMPT_PATH.read_text()
    user_payload = json.dumps(
        {
            "draft": req.draft,
            "hook": req.hook or "",
            "instruction": req.instruction,
            "person": req.person.model_dump(exclude_none=True),
        }
    )

    llm = make_llm()
    started = time.monotonic()
    try:
        raw = await asyncio.to_thread(llm, system, user_payload)
    except Exception as exc:  # noqa: BLE001
        # Ollama refused connection, timed out, or blew up — bubble a friendly 503.
        raise HTTPException(
            status_code=503,
            detail=f"refine LLM unreachable: {type(exc).__name__}: {exc}",
        ) from exc
    elapsed_ms = int((time.monotonic() - started) * 1000)

    try:
        variants = _extract_variants(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"could not parse variants from model output: {exc}",
        ) from exc

    return {
        "variants": variants,
        "model": getattr(llm, "model", "unknown"),
        "provider": getattr(llm, "provider", "unknown"),
        "elapsed_ms": elapsed_ms,
    }


class RerunQueryRequest(BaseModel):
    plan: CrustQueryPlan


@app.post("/rerun-query")
async def rerun_query(req: RerunQueryRequest) -> dict[str, Any]:
    """Re-run a single Crustdata query with a (possibly edited) payload.

    Used by the transparency panel so the user can tweak filters and see what
    changes. Returns the raw candidate list plus a short preview, not a full
    pipeline re-run — ranking/enrichment stay on the original results."""
    crust = _build_crust()
    started = time.monotonic()
    try:
        raw_results = await crust.fan_out([req.plan])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"crustdata call failed: {type(exc).__name__}: {exc}",
        ) from exc
    elapsed_ms = int((time.monotonic() - started) * 1000)

    if not raw_results:
        return {"count": 0, "preview": [], "elapsed_ms": elapsed_ms, "error": None}

    item = raw_results[0]
    err = item.get("error")
    if err:
        return {
            "count": 0,
            "preview": [],
            "elapsed_ms": elapsed_ms,
            "error": str(err),
        }
    candidates = _extract_candidates(item.get("endpoint"), item.get("response"))
    preview: list[dict[str, Any]] = []
    for cand in candidates[:3]:
        preview.append(
            {
                "name": cand.get("name")
                or cand.get("full_name")
                or cand.get("title")
                or cand.get("company_name")
                or "—",
                "subtitle": (
                    cand.get("title")
                    or cand.get("headline")
                    or cand.get("industry")
                    or cand.get("domain")
                    or ""
                ),
            }
        )
    return {
        "count": len(candidates),
        "preview": preview,
        "elapsed_ms": elapsed_ms,
        "error": None,
    }


@app.get("/match/{match_id}/events")
async def match_events(match_id: str) -> EventSourceResponse:
    job = _jobs.get(match_id)
    if job is None:
        raise HTTPException(status_code=404, detail="match not found")

    async def event_source():
        while True:
            kind, payload = await job.queue.get()
            if kind == _DONE_SENTINEL[0]:
                break
            if kind == "stage":
                yield {"event": "stage", "data": payload.model_dump_json()}
            elif kind == "log":
                yield {"event": "log", "data": payload.model_dump_json()}
            elif kind == "result":
                yield {"event": "result", "data": payload.model_dump_json()}
            elif kind == "queue":
                yield {"event": "queue", "data": json.dumps(payload)}
            elif kind == "error":
                yield {"event": "error", "data": json.dumps(payload)}

    return EventSourceResponse(event_source())


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _load_gallery_item(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    result = data.get("result") or {}
    return {
        "slug": data.get("slug") or path.stem,
        "display_name": data.get("display_name") or path.stem,
        "tagline": data.get("tagline") or "",
        "why": data.get("why") or "",
        "baked_at": data.get("baked_at"),
        "repo_url": result.get("repo_url"),
        "counts": {
            "investors": len(result.get("investors") or []),
            "design_partners": len(result.get("design_partners") or []),
            "talent": len(result.get("talent") or []),
        },
    }


@app.get("/gallery")
async def list_gallery() -> dict[str, Any]:
    """Pre-computed MatchResults so visitors see something credible while their
    own run is queued behind the single-GPU pipeline."""
    items: list[dict[str, Any]] = []
    if _GALLERY_DIR.is_dir():
        for path in sorted(_GALLERY_DIR.glob("*.json")):
            item = _load_gallery_item(path)
            if item is not None:
                items.append(item)
    return {"items": items}


@app.get("/gallery/{slug}")
async def get_gallery_item(slug: str) -> dict[str, Any]:
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="invalid slug")
    path = _GALLERY_DIR / f"{slug}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="gallery item not found")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"corrupt fixture: {exc}") from exc


def main() -> None:
    import uvicorn

    uvicorn.run(
        "lighthouse.api:app",
        host=os.environ.get("LIGHTHOUSE_HOST", "0.0.0.0"),
        port=int(os.environ.get("LIGHTHOUSE_PORT", "8000")),
        reload=False,
    )


if __name__ == "__main__":
    main()
