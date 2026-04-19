"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import type { PipelineStage } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";

interface Stage {
  key: PipelineStage;
  label: string;
  target: number;
  /** Width as % of container — narrows going down. */
  widthPct: number;
  /** Which pipeline event marks this stage "hot". */
  matchEvent: PipelineStage;
}

const STAGES: readonly Stage[] = [
  { key: "analyzer",     label: "profiles",        target: 700_000_000, widthPct: 100, matchEvent: "analyzer" },
  { key: "thesis",       label: "thesis-match",    target: 2_800,       widthPct: 82,  matchEvent: "thesis" },
  { key: "query_plan",   label: "recent-signal",   target: 180,         widthPct: 64,  matchEvent: "query_plan" },
  { key: "crust_fanout", label: "track-fit",       target: 42,          widthPct: 46,  matchEvent: "crust_fanout" },
  { key: "ranker",       label: "ranked",          target: 15,          widthPct: 30,  matchEvent: "ranker" },
];

/** Human-friendly compact number (700M, 2,800, 42). */
function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000)        return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000)         return n.toLocaleString();
  return Math.round(n).toString();
}

interface CounterProps {
  target: number;
  /** Trigger key — changing this restarts the count-down. */
  runKey: string;
  /** Starting value for count-down animation. */
  from: number;
  /** Skip animation entirely for reduced-motion users. */
  reduced: boolean;
}

function Counter({ target, runKey, from, reduced }: CounterProps) {
  const mv = useMotionValue(reduced ? target : from);
  const display = useTransform(mv, (v) => fmt(v));

  useEffect(() => {
    if (reduced) {
      mv.set(target);
      return;
    }
    // Animate from `from` down to `target` with an ease-out curve.
    // Larger starting numbers get a slightly longer duration for drama.
    const span = Math.max(1, Math.log10(Math.max(from, 2)) - Math.log10(Math.max(target, 2)));
    const duration = Math.min(2.2, 0.9 + span * 0.25);
    mv.set(from);
    const controls = animate(mv, target, {
      duration,
      ease: [0.22, 1, 0.36, 1], // easeOutCubic-ish
    });
    return () => controls.stop();
    // runKey is what re-triggers the animation when a new run begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, target, reduced]);

  return <motion.span className="tabular-nums">{display}</motion.span>;
}

export interface FunnelVizProps {
  /** Stages that have fired (their `done` event arrived). Drives highlighting. */
  completed: Set<PipelineStage>;
  /** The currently-active stage (its `start` event fired, `done` hasn't). */
  active: PipelineStage | null;
  /** Changes whenever a new run starts — used to restart counter animations. */
  runId: string;
}

export default function FunnelViz({ completed, active, runId }: FunnelVizProps) {
  const reduced = useReducedMotion();

  // Lock in the per-run starting values once so the count-down reads naturally.
  const fromValues = useMemo(() => {
    return STAGES.map((s) => s.target * 2.2);
    // Recompute when the run changes — stable per-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Remember prior completed set so we can briefly pulse on newly-done stages.
  const prevCompleted = useRef<Set<PipelineStage>>(new Set());

  // Detect the moment the final stage just finished — triggers a gentle bounce.
  const finalStageKey = STAGES[STAGES.length - 1].matchEvent;
  const finalJustDone =
    completed.has(finalStageKey) && !prevCompleted.current.has(finalStageKey);

  useEffect(() => {
    prevCompleted.current = new Set(completed);
  }, [completed]);

  return (
    <div className="w-full flex flex-col items-center gap-3 py-4 select-none">
      <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
        pipeline
      </div>

      <div className="w-full max-w-md flex flex-col items-center gap-2">
        {STAGES.map((stage, i) => {
          const isDone   = completed.has(stage.matchEvent);
          const isActive = active === stage.matchEvent;
          const isHot    = isActive || isDone;
          const isPending = !isHot;
          const isFinal = i === STAGES.length - 1;

          // Settle bounce on the final stage's done event.
          const bounceAnimate =
            isFinal && finalJustDone && !reduced
              ? { scale: [1, 1.08, 1] }
              : undefined;

          return (
            <motion.div
              key={stage.key}
              initial={false}
              animate={
                bounceAnimate ?? {
                  scale: isActive && !reduced ? 1.05 : 1,
                  // Pending rows pulse 0.4 → 0.6 so the user sees work is active.
                  opacity: isHot
                    ? 1
                    : isPending && !reduced
                    ? [0.4, 0.6, 0.4]
                    : 0.55,
                }
              }
              transition={
                bounceAnimate
                  ? { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
                  : isPending && !reduced
                  ? {
                      opacity: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                      scale: { type: "spring", stiffness: 220, damping: 22 },
                    }
                  : reduced
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 220, damping: 22 }
              }
              style={{ width: `${stage.widthPct}%` }}
              className={clsx(
                "relative rounded-full border px-5 py-3 flex items-center justify-between",
                "backdrop-blur-sm transition-colors",
                isActive
                  ? "border-amber-400/70 bg-amber-400/10 shadow-[0_0_0_4px_rgba(251,191,36,0.12)]"
                  : isDone
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-neutral-300/60 dark:border-neutral-700/60 bg-neutral-50/50 dark:bg-neutral-900/40",
              )}
            >
              {/* active-stage shimmer */}
              {isActive && !reduced && (
                <motion.div
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-amber-400/15 to-transparent"
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
                />
              )}
              <span
                className={clsx(
                  "relative z-[1] text-xs uppercase tracking-wider",
                  isHot ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-500",
                )}
              >
                {stage.label}
              </span>
              <span
                className={clsx(
                  "relative z-[1] font-semibold tabular-nums",
                  i === 0 ? "text-xl" : "text-lg",
                  isHot ? "text-neutral-900 dark:text-white" : "text-neutral-400",
                )}
              >
                <Counter
                  target={stage.target}
                  from={fromValues[i]}
                  runKey={runId}
                  reduced={reduced}
                />
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
