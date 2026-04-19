"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

interface Props {
  running: boolean;
  startedAt: number | null;
  notifyPermission: NotificationPermission | "unsupported";
  onRequestNotify: () => void;
  /** Set while we wait for the browser prompt to resolve. */
  notifyPending?: boolean;
}

const ETA_SECONDS = 60;

/** Elapsed-time banner shown while the pipeline is running.
 * Gives the user an ETA hint and a one-click "notify me when done" button —
 * so they can tab away without feeling abandoned. */
export default function RunBanner({
  running,
  startedAt,
  notifyPermission,
  onRequestNotify,
  notifyPending,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  if (!running || startedAt == null) return null;

  const elapsedMs = Math.max(0, now - startedAt);
  const elapsedSec = elapsedMs / 1000;
  const pct = Math.min(100, (elapsedSec / ETA_SECONDS) * 100);
  const remaining = Math.max(0, ETA_SECONDS - elapsedSec);

  const primaryLabel =
    notifyPermission === "granted"
      ? "Notifications on"
      : notifyPermission === "denied"
      ? "Notifications blocked"
      : notifyPermission === "unsupported"
      ? "Notifications unsupported"
      : notifyPending
      ? "Requesting..."
      : "Notify me when done";

  const clickable =
    notifyPermission === "default" && !notifyPending;

  return (
    <div className="w-full max-w-2xl mx-auto -mt-2 mb-2">
      <div className="rounded-xl border border-amber-300/50 dark:border-amber-400/30 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <span
              aria-hidden
              className="relative flex h-2 w-2"
            >
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-70 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="font-medium">Searching the open web for warm-intro signals</span>
            <span className="text-amber-700/70 dark:text-amber-300/60 tabular-nums">
              {elapsedSec.toFixed(0)}s · ~{Math.round(remaining)}s left
            </span>
          </div>
          <button
            type="button"
            onClick={clickable ? onRequestNotify : undefined}
            disabled={!clickable}
            className={clsx(
              "shrink-0 text-xs rounded-lg px-3 py-1.5 font-medium transition-colors",
              notifyPermission === "granted"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 cursor-default"
                : notifyPermission === "denied" || notifyPermission === "unsupported"
                ? "bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-500 cursor-not-allowed"
                : "bg-amber-500 text-white hover:bg-amber-600",
            )}
            title={
              notifyPermission === "denied"
                ? "Re-enable notifications for this site in browser settings"
                : undefined
            }
          >
            {notifyPermission === "granted" && (
              <span className="mr-1" aria-hidden>
                ✓
              </span>
            )}
            {primaryLabel}
          </button>
        </div>
        <div className="mt-2 h-1 w-full rounded-full bg-amber-200/50 dark:bg-amber-900/40 overflow-hidden">
          <div
            className="h-full bg-amber-500 dark:bg-amber-400 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1 text-[11px] text-amber-800/70 dark:text-amber-300/60">
          First traces appear in ~2s. Full run usually takes ~60s — feel free to tab away.
        </div>
      </div>
    </div>
  );
}
