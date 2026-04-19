from __future__ import annotations

import asyncio
import json
import os
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
from lighthouse.models import MatchResult, StageEvent
from lighthouse.pipeline import Pipeline

_DONE_SENTINEL = ("__done__", None)


class MatchRequest(BaseModel):
    repo_url: str
    location: str | None = "Bangalore"


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
async def create_match(req: MatchRequest) -> dict[str, str]:
    match_id = uuid.uuid4().hex
    job = _Job()
    _jobs[match_id] = job

    llm = make_llm()
    crust = _build_crust()
    pipeline = Pipeline(llm=llm, crust=crust)

    def on_event(ev: StageEvent) -> None:
        job.queue.put_nowait(("stage", ev))

    async def run() -> None:
        try:
            result = await pipeline.run(
                req.repo_url, location=req.location, on_event=on_event
            )
            job.result = result
            job.queue.put_nowait(("result", result))
        except Exception as exc:  # noqa: BLE001
            job.error = str(exc)
            job.queue.put_nowait(("error", {"message": str(exc)}))
        finally:
            job.queue.put_nowait(_DONE_SENTINEL)

    job.task = asyncio.create_task(run())
    return {"match_id": match_id}


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
            elif kind == "result":
                yield {"event": "result", "data": payload.model_dump_json()}
            elif kind == "error":
                yield {"event": "error", "data": json.dumps(payload)}

    return EventSourceResponse(event_source())


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
