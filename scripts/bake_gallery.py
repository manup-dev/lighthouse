"""Pre-compute full Lighthouse runs for a curated set of GitHub repos.

Each repo's `MatchResult` is serialised to `lighthouse/fixtures/gallery/{slug}.json`
so the frontend can show instant, credible sample output while a user's real
run is queued behind the single-GPU pipeline.

Pick repos that overlap with the judges/audience we're demoing to — each
selection is annotated below so the curation is easy to review.

Usage:
    uv run python scripts/bake_gallery.py            # bake everything
    uv run python scripts/bake_gallery.py qdrant     # bake one by slug
    uv run python scripts/bake_gallery.py --force    # re-bake, ignore cache
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Make `lighthouse` importable when run as `python scripts/bake_gallery.py`.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lighthouse.api import _build_crust  # noqa: E402
from lighthouse.llm import make_llm  # noqa: E402
from lighthouse.models import LogEvent, StageEvent  # noqa: E402
from lighthouse.pipeline import Pipeline  # noqa: E402

FIXTURES_DIR = ROOT / "lighthouse" / "fixtures" / "gallery"


@dataclass
class GalleryPick:
    slug: str
    repo_url: str
    display_name: str
    tagline: str
    location: str | None
    user_hint: str | None
    # short string shown under the card — explains why this repo is in the gallery
    why: str


PICKS: list[GalleryPick] = [
    GalleryPick(
        slug="qdrant",
        repo_url="https://github.com/qdrant/qdrant",
        display_name="Qdrant",
        tagline="Vector search engine in Rust",
        location="Berlin",
        user_hint="AI infrastructure / vector database — well-funded OSS.",
        why="AI data-infra darling; Nirant built FastEmbed on top of it.",
    ),
    GalleryPick(
        slug="hasura",
        repo_url="https://github.com/hasura/graphql-engine",
        display_name="Hasura",
        tagline="Instant GraphQL on any Postgres",
        location="Bangalore",
        user_hint="Developer tooling, OSS-first, Indian-origin unicorn.",
        why="Accel-backed Indian-origin unicorn; Grayscale references Hasura directly.",
    ),
    GalleryPick(
        slug="nuclei",
        repo_url="https://github.com/projectdiscovery/nuclei",
        display_name="Nuclei",
        tagline="Fast, customizable vulnerability scanner",
        location="San Francisco",
        user_hint="Security / DevSecOps tooling, community-driven.",
        why="Security + IaC — Gearsec's exact domain.",
    ),
    GalleryPick(
        slug="bevy",
        repo_url="https://github.com/bevyengine/bevy",
        display_name="Bevy",
        tagline="Data-driven game engine in Rust",
        location=None,
        user_hint="Game engine, systems programming, open source community.",
        why="Modern Rust game engine — Aeos Games territory.",
    ),
    GalleryPick(
        slug="llama-cpp",
        repo_url="https://github.com/ggml-org/llama.cpp",
        display_name="llama.cpp",
        tagline="LLM inference in C/C++",
        location=None,
        user_hint="Local LLM inference, quantisation, runs on consumer GPUs.",
        why="What powers this very demo — a meta nod everyone recognises.",
    ),
]


def _slugs() -> list[str]:
    return [p.slug for p in PICKS]


def _find(slug: str) -> GalleryPick:
    for p in PICKS:
        if p.slug == slug:
            return p
    raise SystemExit(f"unknown slug: {slug!r}. Known: {_slugs()}")


async def _bake_one(pick: GalleryPick, *, force: bool) -> Path:
    out_path = FIXTURES_DIR / f"{pick.slug}.json"
    if out_path.exists() and not force:
        print(f"  ↳ {pick.slug}: already baked → {out_path.relative_to(ROOT)}")
        return out_path

    llm = make_llm()
    crust = _build_crust()
    pipeline = Pipeline(llm=llm, crust=crust)

    def on_event(ev: StageEvent) -> None:
        if ev.status in ("start", "done"):
            print(f"    [{pick.slug}] {ev.stage}: {ev.status}")

    def on_log(ev: LogEvent) -> None:
        # Keep console quiet — just show warnings + the occasional trace.
        if ev.level != "info":
            print(f"    [{pick.slug}] ! {ev.message}")

    t0 = time.monotonic()
    result = await pipeline.run(
        pick.repo_url,
        location=pick.location,
        on_event=on_event,
        on_log=on_log,
        user_hint=pick.user_hint,
    )
    elapsed = time.monotonic() - t0

    # Wrap MatchResult in a small envelope with gallery metadata so the UI
    # doesn't have to re-derive display names from the repo URL.
    envelope = {
        "slug": pick.slug,
        "display_name": pick.display_name,
        "tagline": pick.tagline,
        "why": pick.why,
        "baked_at": time.time(),
        "result": json.loads(result.model_dump_json()),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2))
    print(
        f"  ✓ {pick.slug}: baked in {elapsed:.1f}s "
        f"({len(result.investors)}/{len(result.design_partners)}/{len(result.talent)} matches)"
    )
    return out_path


async def _bake_all(slugs: list[str], *, force: bool) -> None:
    picks = [_find(s) for s in slugs] if slugs else PICKS
    print(f"Baking {len(picks)} gallery fixture(s) → {FIXTURES_DIR.relative_to(ROOT)}")
    for i, pick in enumerate(picks, start=1):
        print(f"[{i}/{len(picks)}] {pick.display_name} ({pick.repo_url})")
        try:
            await _bake_one(pick, force=force)
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {pick.slug}: FAILED — {type(exc).__name__}: {exc}")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "slugs",
        nargs="*",
        help=f"Specific slugs to bake (default: all). Known: {_slugs()}",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-bake even if fixture file already exists.",
    )
    args = parser.parse_args()
    asyncio.run(_bake_all(args.slugs, force=args.force))


if __name__ == "__main__":
    main()
