"use client";

import { motion } from "framer-motion";
import { useState, type MouseEvent } from "react";
import clsx from "clsx";
import PersonCard from "@/components/PersonCard";
import type { MatchedPerson, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import {
  missionKey,
  useMissionStore,
  type MissionStatus,
} from "@/lib/mission";

export interface MissionCardProps {
  person: MatchedPerson;
  track: Track;
  onRefine: (person: MatchedPerson) => void;
  onHandoff: (person: MatchedPerson) => void;
}

type CopyState = "idle" | "pressed" | "success";

const STATUS_CHIP: Record<MissionStatus, string> = {
  drafted:
    "border-neutral-300 dark:border-neutral-700 bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  refined:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  sent:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  replied:
    "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  meeting:
    "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  won:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  lost:
    "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const MISSION_ORDER_LOCAL: MissionStatus[] = [
  "drafted",
  "refined",
  "sent",
  "replied",
  "meeting",
  "won",
];

function nextInOrder(status: MissionStatus): MissionStatus {
  const idx = MISSION_ORDER_LOCAL.indexOf(status);
  if (idx === -1) return status; // e.g. "lost"
  if (idx >= MISSION_ORDER_LOCAL.length - 1) return status;
  return MISSION_ORDER_LOCAL[idx + 1];
}

function daysRemaining(snoozeUntil: number | undefined): number | null {
  if (!snoozeUntil) return null;
  const ms = snoozeUntil - Date.now();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export default function MissionCard({
  person,
  track,
  onRefine,
  onHandoff,
}: MissionCardProps) {
  const reduced = useReducedMotion();
  const { get, advance, regress, snooze } = useMissionStore();
  const key = missionKey(person);
  const mission = get(key);
  const status: MissionStatus = mission?.status ?? "drafted";
  const remainingDays = daysRemaining(mission?.snooze_until);

  const [copyState, setCopyState] = useState<CopyState>("idle");

  function handleChipClick(e: MouseEvent<HTMLButtonElement>) {
    if (e.shiftKey) {
      regress(key);
      return;
    }
    const target = nextInOrder(status);
    if (target !== status) {
      advance(key, target);
    }
  }

  async function handleCopySent() {
    setCopyState("pressed");
    try {
      await navigator.clipboard.writeText(person.warm_intro_draft);
    } catch {
      // ignore clipboard failures in insecure contexts
    }
    advance(key, "sent");
    window.setTimeout(() => {
      setCopyState("success");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }, 200);
  }

  const copySentLabel =
    copyState === "success"
      ? "✓ sent"
      : copyState === "pressed"
      ? "copying…"
      : "📋 Copy + mark Sent";

  const snoozeLabel =
    remainingDays != null ? `zzz ${remainingDays} d` : "⋯ Snooze 3d";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {/* Status chip — absolutely positioned top-left */}
        <motion.button
          type="button"
          onClick={handleChipClick}
          whileHover={reduced ? undefined : { scale: 1.04 }}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
          }
          aria-label={`mission status: ${status}. click to advance, shift-click to regress.`}
          title="click to advance · shift-click to regress"
          className={clsx(
            "absolute top-3 left-3 z-10",
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
            "text-[10px] uppercase tracking-wider font-medium",
            "backdrop-blur-sm shadow-sm",
            STATUS_CHIP[status],
          )}
        >
          <span
            aria-hidden
            className={clsx(
              "inline-block h-1.5 w-1.5 rounded-full",
              status === "drafted" && "bg-neutral-400",
              status === "refined" && "bg-sky-500",
              status === "sent" && "bg-amber-500",
              status === "replied" && "bg-violet-500",
              status === "meeting" && "bg-indigo-500",
              status === "won" && "bg-emerald-500",
              status === "lost" && "bg-rose-500",
            )}
          />
          {status}
        </motion.button>

        <PersonCard person={person} track={track} />
      </div>

      {/* Actions row */}
      <div
        className={clsx(
          "flex items-center gap-2 flex-wrap",
          "rounded-2xl border px-3 py-2",
          "border-neutral-200 dark:border-neutral-800",
          "bg-white/60 dark:bg-neutral-900/50 backdrop-blur-sm",
        )}
      >
        <button
          type="button"
          onClick={() => onRefine(person)}
          className={clsx(
            "rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors",
            "border-neutral-300 dark:border-neutral-700",
            "bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200",
            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          ✨ Refine
        </button>

        <button
          type="button"
          onClick={handleCopySent}
          disabled={copyState !== "idle"}
          className={clsx(
            "rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors",
            copyState === "success"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : copyState === "pressed"
              ? "border-neutral-400 bg-neutral-500 text-white"
              : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          {copySentLabel}
        </button>

        <button
          type="button"
          onClick={() => onHandoff(person)}
          className={clsx(
            "rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors",
            "border-neutral-300 dark:border-neutral-700",
            "bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200",
            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          🎯 Handoff to Claude Code
        </button>

        <button
          type="button"
          onClick={() => snooze(key, 3)}
          className={clsx(
            "ml-auto rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors",
            remainingDays != null
              ? "border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
              : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          {snoozeLabel}
        </button>
      </div>
    </div>
  );
}
