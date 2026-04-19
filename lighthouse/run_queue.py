"""Single-slot run queue for serialising GPU-bound pipeline runs.

The hackathon demo runs on one local GPU — Qwen can't answer two prompts at
once without thrashing, so we let exactly one pipeline execute at a time and
park everyone else in a FIFO. The UI polls `position(job_id)` to render
"You're #3 — here are some cached examples while you wait".
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager


class QueueFull(Exception):
    """Raised when a new submission would push depth past max_depth.

    Frontend maps this to an HTTP 503 + gallery fallback — nobody sees a raw
    error, they see "demo is slammed, browse these pre-baked runs instead"."""

    def __init__(self, depth: int):
        super().__init__(f"run queue is full (depth={depth})")
        self.depth = depth


class RunQueue:
    def __init__(self, max_depth: int = 20):
        self._sem = asyncio.Semaphore(1)
        self._waiters: list[str] = []  # job_ids in arrival order
        self._max_depth = max_depth

    def depth(self) -> int:
        return len(self._waiters)

    def position(self, job_id: str) -> int:
        """0 = currently running, 1 = next up, N = N runs ahead, -1 = not tracked."""
        try:
            return self._waiters.index(job_id)
        except ValueError:
            return -1

    @asynccontextmanager
    async def slot(self, job_id: str):
        if self.depth() >= self._max_depth:
            raise QueueFull(depth=self.depth())
        self._waiters.append(job_id)
        try:
            try:
                await self._sem.acquire()
            except asyncio.CancelledError:
                # Client abandoned the wait (e.g. closed the tab); drop the
                # waiter and re-raise so the caller's task unwinds cleanly.
                self._remove(job_id)
                raise
            try:
                yield
            finally:
                self._sem.release()
        finally:
            # Safe even if we already removed on cancellation.
            self._remove(job_id)

    def _remove(self, job_id: str) -> None:
        try:
            self._waiters.remove(job_id)
        except ValueError:
            pass
