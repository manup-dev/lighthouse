"use client";

import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useMissionStore, type MissionStatus } from "@/lib/mission";
import { useReducedMotion } from "@/lib/useReducedMotion";

export interface CommandCenterStripProps {
  className?: string;
}

// Always visible in the strip — the spine of the funnel, even when zero.
const ALWAYS_ON: MissionStatus[] = ["drafted", "sent", "replied", "meeting"];
// Shown only when count > 0 to keep the strip tight.
const OPTIONAL: MissionStatus[] = ["refined", "won", "lost"];

const LABELS: Record<MissionStatus, string> = {
  drafted: "Drafted",
  refined: "Refined",
  sent: "Sent",
  replied: "Replied",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
};

const MS_PER_DAY = 86_400_000;

function formatNextDue(due: { key: string; due_at: number } | null): string {
  if (!due) return "no pings scheduled";
  const diff = due.due_at - Date.now();
  if (diff <= 0) return "ping due now";
  const days = Math.floor(diff / MS_PER_DAY);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(diff / (60 * 60 * 1000)));
    return `next ping due in ${hours}h`;
  }
  return `next ping due in ${days}d`;
}

function AnimatedCount({
  value,
  reduced,
}: {
  value: number;
  reduced: boolean;
}) {
  return (
    <span className="relative inline-block tabular-nums min-w-[1ch] text-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduced ? false : { y: -6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 6, opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export default function CommandCenterStrip({ className }: CommandCenterStripProps) {
  const { summary, nextDue } = useMissionStore();
  const reduced = useReducedMotion();

  const counts = summary();
  const due = nextDue();

  const visible: MissionStatus[] = [
    ...ALWAYS_ON,
    ...OPTIONAL.filter((s) => (counts[s] ?? 0) > 0),
  ].sort(
    (a, b) =>
      [
        "drafted",
        "refined",
        "sent",
        "replied",
        "meeting",
        "won",
        "lost",
      ].indexOf(a) -
      [
        "drafted",
        "refined",
        "sent",
        "replied",
        "meeting",
        "won",
        "lost",
      ].indexOf(b),
  );

  return (
    <div className={clsx("self-stretch flex justify-center", className)}>
      <div
        className={clsx(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1",
          "border-neutral-200 dark:border-neutral-800",
          "bg-neutral-50/80 dark:bg-neutral-900/60",
          "text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-400",
        )}
        aria-label="mission command center"
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400"
        />
        {visible.map((status, i) => (
          <span key={status} className="inline-flex items-center gap-1">
            {i > 0 && <span className="opacity-40">·</span>}
            <span className="text-neutral-500 dark:text-neutral-500">
              {LABELS[status]}
            </span>
            <span className="text-neutral-800 dark:text-neutral-200">
              <AnimatedCount value={counts[status] ?? 0} reduced={reduced} />
            </span>
          </span>
        ))}
        <span className="opacity-40">·</span>
        <span className="text-neutral-500 dark:text-neutral-400">
          {formatNextDue(due)}
        </span>
      </div>
    </div>
  );
}
