# Lighthouse

**From `git push` to go-to-market.**

Lighthouse is a founder's command center. Paste a GitHub repo URL. Twenty seconds later, three ranked lists of five humans each:

- **5 investors** who posted publicly about your technical moat in the last 14 days
- **5 design partners** — companies whose execs publicly signalled the pain you solve
- **5 senior hires** within commuting distance, scored on trajectory and recent public activity

Every one of the fifteen comes with a warm-intro draft **grounded in something that person actually published in the last two weeks.** No cold templates.

---

## Why this shape

A founder's first six months is three parallel research streams — fundraising, sales, hiring — and all three collapse to the same move: *find humans who already publicly signalled that they care, then send a specific, grounded message.* Lighthouse is the agent that does all three from one input.

## How it works

```
GitHub repo URL
    │
    ▼
RepoAnalyzer     ← README, pyproject / package.json, last 50 commits
    │
    ▼
ThesisEngine     ← Claude call #1: moat · themes · ICP · ideal-hire profile
    │
    ▼
QueryPlanner     ← Claude call #2: 6–9 Crustdata-native payloads
    │              (title-normalized, geo-distanced)
    ▼
CrustClient      ← async fan-out to Person · Company · Web APIs
    │
    ▼
3× Ranker        ← Claude calls #3: one per track, weighted rubric
    │
    ▼
OutreachDrafter  ← Claude call #4 (batched): 15 warm intros
    │              grounded in each person's recent public post
    ▼
Tri-fold funnel: Investors · Design Partners · Talent
```

**4 Claude calls. 6 Crustdata endpoints. 15 outputs. ≈20 seconds. ≈60 credits per run.**

## Design decisions we committed to

- **Every Claude call is visible** in the UI — no black-box reasoning
- **Title normalization at query-plan time**, not match time — one call covers *"Head of Engineering / VP Eng / Director of Engineering"*
- **`geo_distance` is first-class** on the Talent track — each card shows its explicit radius
- **Contact history is client-side only** — localStorage remembers who you copied / marked sent. Dedup badges warn before re-contacting. Zero server-side PII.
- **Four single-turn LLM calls**, not an agent loop — deterministic, inspectable, cacheable

## Powered by

- **Crustdata** — `/person/search`, `/person/enrich`, `/company/search`, `/company/enrich`, `/company/identify`, `/web/search/live`
- **Claude** (Anthropic, Sonnet 4.6) — thesis extraction, query planning, ranking, outreach generation
- **Model Context Protocol (MCP)** — same engine callable from inside Claude Code

## Surfaces

```bash
# CLI — one-shot
lighthouse https://github.com/manup-dev/lighthouse

# Web UI
uvicorn surfaces.api:app --port 8000
cd surfaces/web && npm run dev   # → http://localhost:3000

# MCP (from inside Claude Code)
/mcp → lighthouse → "find investors for https://github.com/manup-dev/lighthouse"
```

## One engine, many personas

Lighthouse is structured as `ArtifactAdapter → Thesis → TrackMix → Rubric`. Swap those slots, get a different product on the same engine:

| Persona        | Input artifact              | Output tracks                                    |
|---             |---                          |---                                               |
| Founder        | GitHub repo                 | Investors · Design Partners · Talent             |
| Recruiter      | Job description URL         | Active · Passive · Prior-employer intel          |
| Investor / VC  | Thesis paragraph            | Deal candidates · Founders to meet · Co-investors|
| BD / Sales     | Product page or one-pager   | Target accounts · Champions · Intent-signal buyers |

Founder mode is today's demo; each other persona is one adapter away.

## Status

Built at **ContextCon** — Crustdata × Y Combinator, Bengaluru, 19 April 2026. Lighthouse touches three of YC's Spring 2026 RFS themes from a single input — AI-Native Agencies, AI-Native Hedge Funds (investor mode), AI Guidance for Physical Work (geo-located hiring).

## The team

Solo founder for now - Manu
Install other project chrome extension [themarkdownreader]([url](https://github.com/manup-dev/themarkdownreader)) to read this better

## License

MIT

