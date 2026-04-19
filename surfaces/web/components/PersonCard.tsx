"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { MatchedPerson, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { getFirstSeen, recordSeen, relativeFromMs } from "@/lib/seen";

export interface PersonCardProps {
  person: MatchedPerson;
  track: Track;
}

type CopyState = "idle" | "pressed" | "success";

function relativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = Date.now() - then.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function trackMeta(track: Track): { label: string; accent: string } {
  switch (track) {
    case "investor":
      return { label: "investor", accent: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" };
    case "design_partner":
      return { label: "design partner", accent: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" };
    case "talent":
      return { label: "senior hire", accent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
  }
}

/** Map score (0-1 or 0-100) to a tailwind colour class. */
function scoreColor(raw: number): string {
  // score may be 0-1 or 0-100 depending on source; normalise.
  const pct = raw <= 1 ? raw * 100 : raw;
  if (pct >= 85) return "text-emerald-500";
  if (pct >= 75) return "text-lime-500";
  if (pct >= 60) return "text-amber-500";
  return "text-rose-500";
}

/** Deterministic hex colour from a string. */
function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  const palette = [
    "#f87171", "#fb923c", "#fbbf24", "#a3e635",
    "#34d399", "#22d3ee", "#60a5fa", "#a78bfa",
    "#f472b6",
  ];
  return palette[h % palette.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/** LinkedIn handle from a LinkedIn profile URL, or null. */
function linkedinHandle(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function Avatar({ person }: { person: MatchedPerson }) {
  const handle = linkedinHandle(person.linkedin);
  // Try sources in order: logo_url (firm logo from enricher) → LinkedIn avatar
  // (unavatar proxy) → initials. The enricher makes the first source land for
  // most investor/design-partner rows, which otherwise have no LinkedIn.
  const initialStage: "logo" | "remote" | "initials" = person.logo_url
    ? "logo"
    : handle
    ? "remote"
    : "initials";
  const [stage, setStage] = useState<"logo" | "remote" | "initials">(initialStage);
  const bg = useMemo(() => colorFromString(person.name), [person.name]);

  if (stage === "logo" && person.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.logo_url}
        alt=""
        width={40}
        height={40}
        className="shrink-0 h-10 w-10 rounded-full object-contain p-1 border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-100"
        onError={() => setStage(handle ? "remote" : "initials")}
      />
    );
  }

  if (stage === "remote" && handle) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://unavatar.io/linkedin/${handle}?fallback=false`}
        alt=""
        width={40}
        height={40}
        className="shrink-0 h-10 w-10 rounded-full object-cover border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800"
        onError={() => setStage("initials")}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-xs font-semibold text-white"
      style={{ backgroundColor: bg }}
    >
      {initialsOf(person.name)}
    </div>
  );
}

/** Track-specific context pill (firm/check size, headcount/industry, geo). */
function TrackPill({ person, track }: PersonCardProps) {
  const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]";
  if (track === "investor") {
    return (
      <span className={clsx(base, "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300")}>
        {person.company}
        {person.sub_scores?.stage_fit != null && (
          <span className="opacity-60"> · seed-series A</span>
        )}
      </span>
    );
  }
  if (track === "design_partner") {
    return (
      <span className={clsx(base, "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300")}>
        {person.company}
        <span className="opacity-60"> · logistics</span>
      </span>
    );
  }
  // talent
  const km = person.geo_distance_km;
  if (km == null) {
    return (
      <span className={clsx(base, "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300")}>
        {person.company}
      </span>
    );
  }
  const rounded = km < 1 ? "<1" : Math.round(km).toString();
  return (
    <span className={clsx(base, "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300")}>
      within {rounded} km of Bengaluru
    </span>
  );
}

/** Inline list of sub-score rows with a mini bar. */
function SubScores({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-neutral-500 italic">no sub-score breakdown</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(([k, v]) => {
        const pct = Math.max(0, Math.min(100, Math.round((v <= 1 ? v * 100 : v))));
        return (
          <li key={k} className="flex items-center gap-2 text-xs">
            <span className="w-28 text-neutral-500 truncate">{k}</span>
            <span className="flex-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <span
                className="block h-full bg-neutral-900 dark:bg-neutral-100"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="tabular-nums text-neutral-700 dark:text-neutral-300 w-8 text-right">
              {pct}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function PersonCard({ person, track }: PersonCardProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const meta = trackMeta(track);
  const scoreCls = scoreColor(person.score);

  // Remember first time we showed this candidate for the "seen N days ago" badge.
  const [firstSeen, setFirstSeen] = useState<number | null>(null);
  useEffect(() => {
    const existing = getFirstSeen(person.linkedin);
    setFirstSeen(existing);
    if (!existing) {
      recordSeen(person.linkedin);
    }
  }, [person.linkedin]);

  async function handleCopy() {
    setCopyState("pressed");
    try {
      await navigator.clipboard.writeText(person.warm_intro_draft);
    } catch {
      // Clipboard API can fail in insecure contexts — silently accept,
      // the flash still signals intent to the user.
    }
    window.setTimeout(() => {
      setCopyState("success");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }, 200);
  }

  const copyLabel =
    copyState === "success" ? "✓ copied" :
    copyState === "pressed" ? "copying…" :
    "📋 copy warm intro";

  const relDate = relativeDate(person.recent_post_date);

  return (
    <motion.article
      whileHover={reduced ? undefined : { y: -4 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        "group relative rounded-2xl border p-5 flex flex-col gap-3",
        "border-neutral-200 dark:border-neutral-800",
        "bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm",
        "shadow-sm hover:shadow-md transition-shadow",
      )}
    >
      {/* seen-before badge */}
      {firstSeen && (
        <span
          className="absolute top-3 right-3 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/70 text-neutral-500"
          title={`First seen on ${new Date(firstSeen).toLocaleDateString()}`}
        >
          seen {relativeFromMs(firstSeen)}
        </span>
      )}

      {/* top row: identity + score */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex items-start gap-3">
          <Avatar person={person} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-50 truncate">
                {person.name}
              </h3>
              <span
                className={clsx(
                  "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                  meta.accent,
                )}
              >
                {meta.label}
              </span>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
              {person.title} <span className="opacity-60">·</span> {person.company}
            </p>
            <div className="mt-2">
              <TrackPill person={person} track={track} />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="toggle sub-scores"
          className="shrink-0 text-right rounded-lg px-1 -mr-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <div className={clsx(
            "text-3xl font-bold tabular-nums leading-none",
            scoreCls,
          )}>
            {person.score.toFixed(2)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 mt-1">
            score {expanded ? "▲" : "▼"}
          </div>
        </button>
      </div>

      {/* sub-score breakdown — click the score to toggle */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="subscores"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-1 pb-1">
              <SubScores scores={person.sub_scores} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* recent post */}
      {person.recent_post && (
        <figure className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
          <blockquote className="italic text-sm text-neutral-700 dark:text-neutral-300 line-clamp-3 before:content-['“'] before:text-3xl before:text-neutral-300 dark:before:text-neutral-600 before:mr-1 before:leading-none before:align-[-0.35em]">
            {person.recent_post}
          </blockquote>
          <figcaption className="mt-1 text-[11px] text-neutral-500">
            {relDate && <span>posted {relDate}</span>}
            {person.recent_post_url && (
              <>
                {relDate && <span className="mx-1">·</span>}
                <a
                  href={person.recent_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  source
                </a>
              </>
            )}
          </figcaption>
        </figure>
      )}

      {/* CTA row */}
      <div className="flex items-center justify-between gap-3 pt-1">
        {person.linkedin ? (
          <a
            href={person.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline"
          >
            LinkedIn
          </a>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={copyState !== "idle"}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
            copyState === "success"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : copyState === "pressed"
              ? "border-neutral-400 bg-neutral-500 text-white"
              : "border-neutral-300 dark:border-neutral-700 bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
          )}
        >
          {copyLabel}
        </button>
      </div>
    </motion.article>
  );
}
