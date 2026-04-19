from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from lighthouse.crust_client import CrustClient
from lighthouse.llm import make_llm
from lighthouse.models import CrustQueryPlan, MatchResult, StageEvent
from lighthouse.pipeline import Pipeline

app = typer.Typer(add_completion=False, no_args_is_help=True)
console = Console()


class _DryRunCrust:
    """Returns canned per-track candidates without hitting Crustdata."""

    _DEMO = {
        "investor": [
            {"name": "Accel Partner A", "title": "Partner", "company": "Accel", "linkedin": "https://linkedin.com/in/accel-a", "recent_post": "Excited about routing infra.", "recent_post_date": "2026-04-12", "recent_post_url": "https://example.com/p/1"},
            {"name": "Peak XV Partner", "title": "Partner", "company": "Peak XV", "linkedin": "https://linkedin.com/in/peakxv", "recent_post": "Logistics tech is underinvested.", "recent_post_date": "2026-04-10", "recent_post_url": "https://example.com/p/2"},
            {"name": "Lightspeed GP", "title": "General Partner", "company": "Lightspeed", "linkedin": "https://linkedin.com/in/lightspeed-gp", "recent_post": "Routing, dispatch, and the India opportunity.", "recent_post_date": "2026-04-08", "recent_post_url": "https://example.com/p/3"},
            {"name": "Blume Partner", "title": "Partner", "company": "Blume", "linkedin": "https://linkedin.com/in/blume", "recent_post": "Our thesis on vertical SaaS for freight.", "recent_post_date": "2026-04-05", "recent_post_url": "https://example.com/p/4"},
            {"name": "Neon Fund Partner", "title": "Partner", "company": "Neon Fund", "linkedin": "https://linkedin.com/in/neon", "recent_post": "India tier-2 freight is ready.", "recent_post_date": "2026-04-14", "recent_post_url": "https://example.com/p/5"},
        ],
        "design_partner": [
            {"name": "Delhivery Ops VP", "title": "VP Operations", "company": "Delhivery", "linkedin": "https://linkedin.com/in/delhivery-ops", "recent_post": "Route optimisation is still our biggest unsolved problem.", "recent_post_date": "2026-04-13", "recent_post_url": "https://example.com/dp/1"},
            {"name": "Shiprocket CTO", "title": "CTO", "company": "Shiprocket", "linkedin": "https://linkedin.com/in/shiprocket-cto", "recent_post": "We hand-plan last-mile in Excel.", "recent_post_date": "2026-04-11", "recent_post_url": "https://example.com/dp/2"},
            {"name": "Porter Head of Ops", "title": "Head of Ops", "company": "Porter", "linkedin": "https://linkedin.com/in/porter", "recent_post": "Fleet utilisation is the problem.", "recent_post_date": "2026-04-09", "recent_post_url": "https://example.com/dp/3"},
            {"name": "Rivigo COO", "title": "COO", "company": "Rivigo", "linkedin": "https://linkedin.com/in/rivigo", "recent_post": "Dispatch automation changed our unit economics.", "recent_post_date": "2026-04-07", "recent_post_url": "https://example.com/dp/4"},
            {"name": "LocoNav VP Product", "title": "VP Product", "company": "LocoNav", "linkedin": "https://linkedin.com/in/loconav", "recent_post": "Route planning is where carriers bleed.", "recent_post_date": "2026-04-15", "recent_post_url": "https://example.com/dp/5"},
        ],
        "talent": [
            {"name": "Staff Eng Jane", "title": "Staff Engineer", "company": "Delhivery", "linkedin": "https://linkedin.com/in/jane-staff", "recent_post": "Built an OR-Tools VRP solver over the weekend.", "recent_post_date": "2026-04-14", "recent_post_url": "https://example.com/t/1", "geo_distance_km": 8.2},
            {"name": "Principal Eng Ravi", "title": "Principal Engineer", "company": "Shiprocket", "linkedin": "https://linkedin.com/in/ravi-principal", "recent_post": "My notes on routing at scale.", "recent_post_date": "2026-04-11", "recent_post_url": "https://example.com/t/2", "geo_distance_km": 12.4},
            {"name": "VP Eng Meera", "title": "VP Engineering", "company": "Rivigo", "linkedin": "https://linkedin.com/in/meera-vp", "recent_post": "Why dispatch UX matters more than algorithms.", "recent_post_date": "2026-04-09", "recent_post_url": "https://example.com/t/3", "geo_distance_km": 15.0},
            {"name": "Director Eng Arjun", "title": "Director of Engineering", "company": "Porter", "linkedin": "https://linkedin.com/in/arjun-dir", "recent_post": "Hiring for a routing platform team.", "recent_post_date": "2026-04-12", "recent_post_url": "https://example.com/t/4", "geo_distance_km": 6.7},
            {"name": "Staff Eng Divya", "title": "Staff Engineer", "company": "LocoNav", "linkedin": "https://linkedin.com/in/divya-staff", "recent_post": "Constraint solvers are having a moment.", "recent_post_date": "2026-04-15", "recent_post_url": "https://example.com/t/5", "geo_distance_km": 22.1},
        ],
    }

    async def fan_out(self, plans: list[CrustQueryPlan]) -> list[dict[str, Any]]:
        def _key(endpoint: str) -> str:
            if endpoint == "/company/search":
                return "companies"
            if endpoint == "/web/search/live":
                return "results"
            return "profiles"

        out: list[dict[str, Any]] = []
        for plan in plans:
            out.append(
                {
                    "track": plan.track,
                    "endpoint": plan.endpoint,
                    "rationale": plan.rationale,
                    "response": {_key(plan.endpoint): self._DEMO.get(plan.track, [])},
                    "error": None,
                }
            )
        return out


def _on_event(events: list[StageEvent]):
    def cb(ev: StageEvent) -> None:
        events.append(ev)
        if ev.status == "start":
            console.print(f"[cyan]▶[/cyan] {ev.stage}")
        elif ev.status == "done":
            extra = ""
            if ev.payload:
                extra = " [dim]" + " · ".join(f"{k}={v}" for k, v in ev.payload.items()) + "[/dim]"
            console.print(f"[green]✓[/green] {ev.stage}{extra}")

    return cb


def _render_track(title: str, people) -> None:
    table = Table(title=title, show_lines=True, title_style="bold cyan")
    table.add_column("Name", style="bold")
    table.add_column("Title")
    table.add_column("Company")
    table.add_column("Score", justify="right")
    table.add_column("Warm intro", max_width=70)
    for p in people:
        table.add_row(p.name, p.title, p.company, f"{p.score:.1f}", p.warm_intro_draft or "—")
    console.print(table)


@app.command()
def match(
    repo_url: str = typer.Argument(..., help="GitHub repo URL or local path"),
    location: str = typer.Option("Bangalore", help="City for Talent track geo_distance"),
    provider: str = typer.Option(None, help="LLM provider override: ollama | anthropic"),
    cache_dir: Path = typer.Option(Path(".cache/crust"), help="Crustdata response cache dir"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Use canned Crustdata responses (no API key needed)"),
    output_json: bool = typer.Option(False, "--json", help="Print raw MatchResult JSON after the funnel"),
) -> None:
    """Find investors, design partners, and senior hires for a repo."""
    load_dotenv()

    if dry_run:
        crust: Any = _DryRunCrust()
    else:
        api_key = os.environ.get("CRUSTDATA_API_KEY")
        if not api_key:
            console.print("[red]CRUSTDATA_API_KEY is not set.[/red] Put it in .env or re-run with --dry-run.")
            raise typer.Exit(1)
        crust = CrustClient(api_key=api_key, cache_dir=cache_dir)

    llm = make_llm(provider)
    events: list[StageEvent] = []
    pipeline = Pipeline(llm=llm, crust=crust)

    result: MatchResult = asyncio.run(
        pipeline.run(repo_url, location=location, on_event=_on_event(events))
    )

    console.print()
    _render_track("Investors", result.investors)
    _render_track("Design Partners", result.design_partners)
    _render_track("Talent", result.talent)

    console.print(
        f"\n[dim]thesis:[/dim] {result.thesis.moat}"
        f"\n[dim]queries:[/dim] {result.stats.get('query_count')}"
        f"\n[dim]duration:[/dim] {result.stats.get('duration_sec')}s"
    )

    if output_json:
        sys.stdout.write("\nPIPELINE_JSON:\n")
        sys.stdout.write(result.model_dump_json())
        sys.stdout.write("\n")


if __name__ == "__main__":
    app()
