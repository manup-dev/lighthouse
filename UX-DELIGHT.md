# UX Delight Backlog — Lighthouse Web UI

Bite-sized improvements (<30 min each) that make users think "oh nice, they thought of that." Scoped to `surfaces/web/`. Implement in priority order; each group is sorted Tier 1 → Tier 3 within it.

---

## Round 1 — 25 opportunities

### Input & URL handling

- [ ] **Live GitHub URL validation** (~5 min)
  Regex `^https://github\.com/[\w.-]+/[\w.-]+/?$`. Red/green border + inline ✓ on valid. Prevents bad submits.

- [ ] **GitHub org/repo avatar preview** (~10 min)
  Once URL parses, show `<img src="https://github.com/{org}.png?size=48" />` left of the input. Tiny visual payoff.

- [ ] **"Try a demo repo" quick-fill link** (~5 min)
  Below the input: "Or try `manup-dev/lighthouse`" — click fills the input and auto-submits.

- [ ] **`/` hotkey focuses the URL input** (~3 min)
  GitHub/Linear pattern; keyboard-first users notice immediately.

- [ ] **Enter submits from anywhere in the form** (~2 min)
  Not just the submit button. Location field also triggers submit on Enter.

### Funnel animation

- [ ] **Counter easing = `easeOutExpo`, not linear** (~5 min)
  Framer Motion `transition={{ ease: [0.16, 1, 0.3, 1] }}`. Feels punchy and deliberate.

- [ ] **Slot-machine digit roll** (~15 min)
  Each digit place rolls independently so "700,000,000 → 2,800" looks mechanical, not instant-snap.

- [ ] **Pending stages pulse at low opacity** (~5 min)
  Stages that haven't started yet pulse 0.4 → 0.6 opacity (2s loop) so user sees work is active.

- [ ] **Active stage gets ambient glow** (~5 min)
  `box-shadow: 0 0 0 1px rgba(59,130,246,0.4), 0 0 24px -4px rgba(59,130,246,0.3)` while status=start.

- [ ] **Final "15" stage sparkle settle** (~5 min)
  One subtle `scale 1.0 → 1.08 → 1.0` bounce on the last stage's done event. No confetti.

### Track tabs + selection

- [ ] **Tab count badge `(5)`** (~3 min)
  Next to each track name after results arrive. Micro-confirmation the data is there.

- [ ] **`1` / `2` / `3` hotkeys switch tabs** (~3 min)
  Power-user pattern from Gmail, Discord.

- [ ] **Sliding underline with `layoutId`** (~5 min)
  Framer Motion `layoutId="tab-underline"` on the active indicator so it slides, doesn't jump.

### Person cards

- [ ] **Score colour interpolation (red→yellow→green)** (~8 min)
  `<60` red-500, `60-74` amber-500, `75-84` lime-500, `85+` emerald-500. Eye drawn to top matches.

- [ ] **Copy-intro button: 3-state machine** (~8 min)
  Idle "📋 Copy", pressed "Copying…" (200ms), success "✓ Copied" green flash (1.5s), reverts.

- [ ] **Card hover lift 4px + shadow ramp** (~3 min)
  `hover:-translate-y-1 hover:shadow-lg transition-all duration-200 ease-out`.

- [ ] **Recent-post excerpt with quote accent** (~3 min)
  `before:content-['“'] before:text-4xl before:text-slate-300 before:mr-1 italic` — turns a blob of text into a quote.

- [ ] **Geo-distance pill on Talent cards** (~5 min)
  Small chip with dot + map-pin SVG + "within 12 km of Bangalore". Visible moat detail from HANDOFF.

- [ ] **Avatar fallback via `unavatar.io` → initials circle** (~10 min)
  `https://unavatar.io/linkedin/{handle}` with `onError` falling back to a deterministic-colour initials bubble.

- [ ] **Click the score to expand sub-scores** (~10 min)
  Inline mini stacked-bar or list: `skill_match 32 · prestige 18 · recency 12 · geo 8`. Ranker's reasoning made visible.

### HowWeSearched panel

- [ ] **Smooth height collapse animation** (~5 min)
  Framer Motion `<AnimatePresence>` + `initial={{ height: 0 }} animate={{ height: "auto" }}`.

- [ ] **Track-coloured left border on each query card** (~3 min)
  `border-l-4` in blue (investor) / purple (design_partner) / emerald (talent). Scan-first cue.

- [ ] **Hand-rolled JSON syntax highlighting** (~15 min)
  Different span classes for keys, strings, numbers, booleans. No heavy lib. Monospace font with `font-feature-settings: "calt"` off.

### Meta & global

- [ ] **Document title as progress indicator** (~3 min)
  While running: `Lighthouse — searching…`, on done: `Lighthouse — 15 results`. Tab-strip becomes a status light.

- [ ] **Top banner with cost + duration** (~5 min)
  Once done: thin strip reads `$0.00 · 23s · local qwen2.5:14b` (or Claude pricing). Transparency = product.

- [ ] **`prefers-reduced-motion` respected everywhere** (~5 min)
  All Framer Motion transitions become `duration: 0` when `window.matchMedia("(prefers-reduced-motion: reduce)").matches`.

- [ ] **localStorage: "seen 3 days ago" badges** (~10 min)
  Track `{linkedin: first_seen_at}` in localStorage key `lighthouse.v1`. Show badge on any candidate previously seen. Dedup is killer for recurring founders.

---

## Implementation notes

- All additions must stay in `surfaces/web/`
- No new deps beyond `framer-motion` + `clsx`
- Respect strict TS — no `any` outside the opaque Crustdata `payload` fields
- Keep commits atomic; one commit per logical group when ready to land
