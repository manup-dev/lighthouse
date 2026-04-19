"""Tests for the single-GPU run queue.

Scenario: one 5070Ti, one Qwen, many hackathon visitors. The queue serialises
access to the pipeline and exposes live position so the UI can tell each
visitor "you are #N".
"""

from __future__ import annotations

import asyncio

import pytest

from lighthouse.run_queue import QueueFull, RunQueue


async def test_single_slot_serialises_execution():
    q = RunQueue(max_depth=10)
    started: list[str] = []
    finished: list[str] = []

    async def work(label: str) -> None:
        async with q.slot(label):
            started.append(label)
            await asyncio.sleep(0.05)
            finished.append(label)

    await asyncio.gather(work("a"), work("b"), work("c"))

    # Exactly one job ran at a time: no finish came before the next start.
    assert started == finished  # strict order = serialised


async def test_position_reports_0_when_running_and_N_when_waiting():
    q = RunQueue(max_depth=10)
    release_a = asyncio.Event()
    a_running = asyncio.Event()

    async def job_a():
        async with q.slot("a"):
            a_running.set()
            await release_a.wait()

    task_a = asyncio.create_task(job_a())
    await a_running.wait()
    assert q.position("a") == 0

    # Enqueue b and c — they should be positions 1 and 2.
    b_started = asyncio.Event()
    c_started = asyncio.Event()

    async def job_b():
        async with q.slot("b"):
            b_started.set()

    async def job_c():
        async with q.slot("c"):
            c_started.set()

    task_b = asyncio.create_task(job_b())
    task_c = asyncio.create_task(job_c())
    await asyncio.sleep(0.02)  # let them enter the waiters list

    assert q.position("b") == 1
    assert q.position("c") == 2
    assert q.depth() == 3

    release_a.set()
    await asyncio.gather(task_a, task_b, task_c)
    assert q.depth() == 0


async def test_position_returns_neg1_for_unknown_id():
    q = RunQueue(max_depth=10)
    assert q.position("nope") == -1


async def test_queue_full_raises_before_slot_acquired():
    q = RunQueue(max_depth=2)

    release = asyncio.Event()

    async def job(label: str):
        async with q.slot(label):
            await release.wait()

    t1 = asyncio.create_task(job("a"))
    t2 = asyncio.create_task(job("b"))
    await asyncio.sleep(0.01)

    # Third submission exceeds max_depth=2 (1 running + 1 waiting).
    with pytest.raises(QueueFull) as exc_info:
        async with q.slot("c"):
            pytest.fail("should never enter")
    assert exc_info.value.depth == 2

    release.set()
    await asyncio.gather(t1, t2)


async def test_abandoned_waiter_frees_slot():
    q = RunQueue(max_depth=10)
    release = asyncio.Event()

    async def blocker():
        async with q.slot("blocker"):
            await release.wait()

    async def abandoned():
        async with q.slot("abandoned"):
            pytest.fail("should be cancelled before entering")

    t_block = asyncio.create_task(blocker())
    await asyncio.sleep(0.01)
    t_ab = asyncio.create_task(abandoned())
    await asyncio.sleep(0.01)
    assert q.depth() == 2

    # Client bails out (browser tab closed) — cancel before slot acquired.
    t_ab.cancel()
    try:
        await t_ab
    except asyncio.CancelledError:
        pass

    # depth should fall back to just the running blocker.
    assert q.depth() == 1
    assert q.position("abandoned") == -1

    release.set()
    await t_block
