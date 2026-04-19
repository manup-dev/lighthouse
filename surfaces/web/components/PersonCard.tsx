"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import clsx from "clsx";
import type { MatchedPerson, Track } from "@/lib/types";

export interface PersonCardProps {
  person: MatchedPerson;
  track: Track;
}

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

export default function PersonCard({ person, track }: PersonCardProps) {
  const [copied, setCopied] = useState(false);
  const meta = trackMeta(track);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(person.warm_intro_draft);
    } catch {
      // Clipboard API can fail in insecure contexts — silently accept,
      // the flash still signals intent to the user.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 400);
  }

  const relDate = relativeDate(person.recent_post_date);

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        "group relative rounded-2xl border p-5 flex flex-col gap-3",
        "border-neutral-200 dark:border-neutral-800",
        "bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm",
        "shadow-sm hover:shadow-md transition-shadow",
      )}
    >
      {/* top row: identity + score */}
      <div className="flex items-start justify-between gap-4">
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

        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-white leading-none">
            {person.score.toFixed(2)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 mt-1">
            score
          </div>
        </div>
      </div>

      {/* recent post */}
      {person.recent_post && (
        <figure className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
          <blockquote className="italic text-sm text-neutral-700 dark:text-neutral-300 line-clamp-3">
            &ldquo;{person.recent_post}&rdquo;
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
          className={clsx(
            "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
            copied
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-neutral-300 dark:border-neutral-700 bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
          )}
        >
          {copied ? "copied" : "copy warm intro"}
        </button>
      </div>
    </motion.article>
  );
}
