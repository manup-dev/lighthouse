"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

import { fetchGallery, fetchGalleryItem, type GalleryItem } from "@/lib/api";
import type { MatchResult } from "@/lib/types";

type Mode = "queued" | "slammed" | "idle";

interface Props {
  /** Current queue position: 0 = running, N = N runs ahead. */
  position: number;
  /** Total runs in flight (including ours). */
  depth: number;
  /** Server-provided seconds-until-our-turn estimate. */
  etaSec: number;
  /** Which banner to show above the gallery grid. Default = queued. */
  mode?: Mode;
  /** Legacy alias for mode="slammed" (queue full → gallery-only fallback). */
  galleryOnly?: boolean;
  /** Called when the user picks a gallery item to explore — lets page.tsx
   * render a full MatchResult view without kicking off a real pipeline run. */
  onOpenSample: (match: MatchResult, meta: GalleryItem) => void;
}

function formatEta(sec: number): string {
  if (sec <= 0) return "seconds";
  if (sec < 60) return `~${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

/** Panel shown while the user's pipeline is queued behind the single-GPU
 * pipeline. Tells them their position + ETA, and gives them a browseable
 * gallery of pre-baked runs so they see something credible immediately. */
export default function QueueWait({
  position,
  depth,
  etaSec,
  mode,
  galleryOnly,
  onOpenSample,
}: Props) {
  const resolvedMode: Mode = mode ?? (galleryOnly ? "slammed" : "queued");
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchGallery(ctl.signal)
      .then(setItems)
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setErr(String(e));
        setItems([]);
      });
    return () => ctl.abort();
  }, []);

  const handleOpen = async (slug: string) => {
    setLoadingSlug(slug);
    try {
      const envelope = await fetchGalleryItem(slug);
      const meta: GalleryItem = {
        slug: envelope.slug,
        display_name: envelope.display_name,
        tagline: envelope.tagline,
        why: envelope.why,
        baked_at: null,
        repo_url: envelope.result.repo_url,
        counts: {
          investors: envelope.result.investors.length,
          design_partners: envelope.result.design_partners.length,
          talent: envelope.result.talent.length,
        },
      };
      onOpenSample(envelope.result, meta);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingSlug(null);
    }
  };

  const heading =
    resolvedMode === "idle"
      ? "Live examples on repos you'll recognise"
      : resolvedMode === "slammed"
      ? "Lighthouse is slammed — browse these real runs"
      : position <= 0
      ? "Your turn — pipeline starting"
      : `You're #${position + 1} in the queue`;

  const sub =
    resolvedMode === "idle"
      ? "Click any card to see the full pipeline output — thesis, five investors, five design partners, five senior hires, and warm-intro drafts grounded in their recent posts."
      : resolvedMode === "slammed"
      ? "We cap the live queue at a reasonable depth so nobody waits forever. Explore these pre-computed runs — they're the real pipeline output on well-known repos."
      : position <= 0
      ? "Traces should start streaming any second."
      : `${position} run${position === 1 ? "" : "s"} ahead · estimated wait ${formatEta(etaSec)}. Explore these real runs while you wait ↓`;

  return (
    <div className="w-full max-w-5xl mx-auto px-6 mt-2 flex flex-col gap-4">
      <div
        className={clsx(
          "rounded-2xl border px-5 py-4",
          resolvedMode === "slammed"
            ? "border-rose-300/40 dark:border-rose-400/30 bg-rose-50/70 dark:bg-rose-950/30"
            : resolvedMode === "idle"
            ? "border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40"
            : "border-sky-300/40 dark:border-sky-400/30 bg-sky-50/70 dark:bg-sky-950/30",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-sky-700/80 dark:text-sky-300/70">
              {resolvedMode === "slammed"
                ? "demo gallery"
                : resolvedMode === "idle"
                ? "gallery"
                : "queued"}
            </div>
            <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {heading}
            </div>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 max-w-2xl">
              {sub}
            </p>
          </div>
          {resolvedMode === "queued" && depth > 0 && (
            <div className="shrink-0 text-xs tabular-nums text-neutral-500">
              depth {depth}
            </div>
          )}
        </div>
      </div>

      {err && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Couldn&rsquo;t load gallery: {err}
        </p>
      )}

      {items && items.length === 0 && !err && (
        <p className="text-sm text-neutral-500">
          Gallery is warming up — paste any public GitHub repo above to kick off a live run.
        </p>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => {
            const isLoading = loadingSlug === it.slug;
            return (
              <button
                key={it.slug}
                type="button"
                onClick={() => handleOpen(it.slug)}
                disabled={isLoading}
                className={clsx(
                  "group text-left rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/50 p-4 shadow-sm transition-all",
                  "hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5",
                  "disabled:opacity-60 disabled:cursor-wait",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {it.display_name}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 group-hover:text-amber-500">
                    {isLoading ? "loading…" : "open →"}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">{it.tagline}</div>
                <div className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
                  {it.why}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
                  <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5">
                    {it.counts.investors} investors
                  </span>
                  <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
                    {it.counts.design_partners} partners
                  </span>
                  <span className="rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2 py-0.5">
                    {it.counts.talent} hires
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
