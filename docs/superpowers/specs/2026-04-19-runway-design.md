# Runway — Lighthouse E2E outreach loop

_Hackathon spec, ContextCon (Crustdata × YC), Bengaluru, 2026-04-19._

## Problem

Lighthouse today ends at "15 cards with drafts". After copying an intro, the product goes silent: no send-tracking, no revise loop, no follow-up, no handoff. Judges (and founders) see beautiful discovery but zero follow-through.

## Goal

Close the loop **inside the existing Web UI**, zero new infra:

1. Per-candidate lifecycle tracking (Drafted → Refined → Sent → Replied → Meeting → Won/Lost).
2. Draft Forge — a local-qwen refiner that generates 3 variants from a chip or free-text instruction.
3. Claude Code handoff — one-click copies a ready-to-paste slash-command prompt that executes outreach autonomously.

Non-goal: email sending, real CRM, server-side persistence, auth.

## Architecture

All additive to `surfaces/web/` + one FastAPI route.

```
PersonCard (existing)
    └── wrapped by MissionCard
           ├── status chip         (useMissionStore → localStorage)
           ├── actions row
           │     ├── ✨ Refine     → DraftForge modal → POST /refine-draft (Ollama)
           │     ├── 📋 Copy+Sent  → clipboard + advance status
           │     ├── 🎯 Handoff    → clipboard with CC prompt template
           │     └── ⋯ Snooze 3d   → mission state snooze_until
           └── timestamp of last state change

RunBanner (existing) ──► CommandCenterStrip above tabs
```

## Components

### Frontend

| File | Purpose |
|---|---|
| `lib/mission.ts` | `useMissionStore()` hook over `localStorage["lighthouse.mission.v1"]`. Shape per candidate: `{status, history: [{state, at}], draft_versions: string[], snooze_until?: number}`. Key = `linkedin` URL, or `name+company` fallback. |
| `components/MissionCard.tsx` | Wraps `PersonCard`, overlays status chip and actions row. Click chip to cycle forward; shift-click cycles back. |
| `components/DraftForge.tsx` | Modal. Left: editable draft. Right: instruction chips + free-text. Bottom: 3 streamed variants. Footer: `~1.2s · local qwen · ₹0`. |
| `components/CommandCenterStrip.tsx` | Strip at top of results: `Drafted 12 · Sent 2 · Replied 1 · Meeting 0 · next follow-up in 2d · ₹0`. Derived from `useMissionStore`. |
| `lib/handoff.ts` | `buildHandoffPrompt(person, draft)` returns a prewritten Claude Code prompt. |

### Backend

| File | Change |
|---|---|
| `lighthouse/api.py` | Add `POST /refine-draft` — body `{draft, hook, instruction, person_summary}`, returns `{variants: string[3], model, elapsed_ms}`. Uses existing `make_llm()`. 3 variants from one prompt; no streaming v1. |

## Data flow — refine

```
MissionCard → "✨ Refine" → DraftForge opens with current draft
                                 │
                      User picks chip or types instruction
                                 ▼
                      POST /refine-draft {draft, hook, instruction, person_summary}
                                 │
                      Ollama qwen2.5:14b (system: "Generate 3 distinct rewrites…")
                                 ▼
                      3 variant cards rendered inline
                                 │
                      User clicks a variant → draft replaced → Keep saves
                                 ▼
                      useMissionStore.advance(person, "Refined")
                      person.warm_intro_draft updated in local state
```

## Data flow — handoff

```
MissionCard → "🎯 Handoff" → buildHandoffPrompt(person, draft) →
  "Use the Gmail MCP to send the following email to <handle>@linkedin.com.
   Subject: <derived>. Body: <draft>. After sending, append a line to
   ~/.lighthouse/ledger.jsonl with {ts, name, status: sent}. If no reply
   in 3 days, draft a follow-up grounded in their latest public post."
→ navigator.clipboard.writeText(prompt)
→ toast: "Handoff copied — paste into Claude Code"
```

## Status ladder

Ordered states, cycle on click:

`Drafted` (default) → `Refined` → `Sent` → `Replied` → `Meeting` → `Won` / `Lost`

Terminal states (Won/Lost) collapse the card to a minimal strip.

## Storage

Single key, single JSON blob, no migrations:

```ts
{
  version: 1,
  missions: {
    [key: string]: {
      status: Status,
      history: {state: Status, at: number}[],
      draft_versions: string[],   // most recent last
      snooze_until?: number
    }
  }
}
```

Key = `linkedin URL` when present, else `hash(name + "|" + company)`.

## Error handling

- Ollama unreachable on `/refine-draft` → 503 with friendly message, modal shows "qwen not reachable — start `ollama serve`" + retry button.
- localStorage quota exceeded → drop oldest `draft_versions` and retry; no user-facing error.
- Clipboard API blocked → fall back to `<textarea>` + "select-all, cmd-c" tooltip.

## Testing

- Manual smoke: submit repo, refine one card, copy+send, handoff — verify each state change persists across reload.
- Unit: `buildHandoffPrompt` snapshot. `useMissionStore.advance` transitions.
- Existing pipeline tests untouched.

## Out of scope (this hackathon)

- Gmail MCP actually sending (user must run handoff in CC themselves)
- Cross-device sync
- Reply detection
- Team accounts

## Demo script

1. Paste `github.com/manup-dev/lighthouse` → results in 20s.
2. Strip shows `Drafted 15 · ₹0`.
3. Open an investor card → `✨ Refine` → click "Sharper" chip → 3 variants stream → click one → Keep.
4. `📋 Copy+Sent` → status chip turns green, strip counter updates.
5. Open a talent card → `🎯 Handoff` → paste into a Claude Code tab in the same demo machine → show the prewritten prompt.
6. Closing line: _"One engine, four loops: find → refine → send → follow-up. All grounded, all local-first."_

## Risks

- Ollama cold-start on qwen:14b can take 10–15s on first `/refine-draft` call. Mitigate with a warmup ping on page load.
- localStorage keyed on LinkedIn URL: some enrichments omit it for investor/DP tracks. Fallback hash is stable but less ideal.
- Handoff prompt assumes Gmail MCP installed — if not, the "slash-command" is still a useful artifact, just doesn't auto-execute.
