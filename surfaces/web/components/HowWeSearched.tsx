"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { CrustQueryPlan, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { rerunQuery, type RerunQueryResponse } from "@/lib/api";
import JsonView from "./JsonView";

export interface HowWeSearchedProps {
  plans: CrustQueryPlan[];
}

const TRACK_COLORS: Record<Track, string> = {
  investor: "text-sky-600 dark:text-sky-400",
  design_partner: "text-violet-600 dark:text-violet-400",
  talent: "text-emerald-600 dark:text-emerald-400",
};

const TRACK_BORDER: Record<Track, string> = {
  investor: "border-l-4 border-l-sky-500",
  design_partner: "border-l-4 border-l-violet-500",
  talent: "border-l-4 border-l-emerald-500",
};

const TRACK_LABEL: Record<Track, string> = {
  investor: "investor",
  design_partner: "design_partner",
  talent: "talent",
};

type RerunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; data: RerunQueryResponse }
  | { status: "error"; message: string };

interface QueryCardProps {
  plan: CrustQueryPlan;
  index: number;
}

function QueryCard({ plan, index }: QueryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() =>
    JSON.stringify(plan.payload, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [rerun, setRerun] = useState<RerunState>({ status: "idle" });
  const reduced = useReducedMotion();

  const parsedDraft = useMemo(() => {
    try {
      return JSON.parse(draft) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [draft]);

  async function handleRerun() {
    if (!parsedDraft) {
      setParseError("Payload is not valid JSON.");
      return;
    }
    setParseError(null);
    setRerun({ status: "running" });
    try {
      const data = await rerunQuery({ ...plan, payload: parsedDraft });
      setRerun({ status: "done", data });
    } catch (err) {
      setRerun({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function resetPayload() {
    setDraft(JSON.stringify(plan.payload, null, 2));
    setParseError(null);
  }

  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60 overflow-hidden",
        TRACK_BORDER[plan.track],
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800 text-left hover:bg-neutral-100/60 dark:hover:bg-neutral-900/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={clsx(
              "text-[10px] uppercase tracking-widest font-semibold shrink-0",
              TRACK_COLORS[plan.track],
            )}
          >
            {TRACK_LABEL[plan.track]}
          </span>
          <code className="text-xs text-neutral-700 dark:text-neutral-300 truncate">
            {plan.endpoint}
          </code>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-neutral-500">#{index + 1}</span>
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.18 }}
            className="text-neutral-400 text-sm select-none"
            aria-hidden
          >
            ›
          </motion.span>
        </div>
      </button>

      <p className="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400 italic border-b border-neutral-200 dark:border-neutral-800">
        {plan.rationale}
      </p>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                  payload
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={resetPayload}
                        className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                      >
                        reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                      >
                        done
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                    >
                      edit
                    </button>
                  )}
                </div>
              </div>
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setParseError(null);
                  }}
                  spellCheck={false}
                  className={clsx(
                    "w-full min-h-[180px] max-h-[320px] font-mono text-[11px] leading-relaxed",
                    "rounded-md border bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200",
                    "p-3 resize-y focus:outline-none focus:ring-2 focus:ring-sky-500/40",
                    parsedDraft === null
                      ? "border-rose-400 dark:border-rose-600"
                      : "border-neutral-200 dark:border-neutral-800",
                  )}
                />
              ) : (
                <div className="text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[320px] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/70 p-3">
                  <JsonView value={parsedDraft ?? plan.payload} />
                </div>
              )}
              {parseError && (
                <div className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
                  {parseError}
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRerun}
                  disabled={rerun.status === "running" || parsedDraft === null}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium",
                    "border border-neutral-300 dark:border-neutral-700",
                    "bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100",
                    "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "transition-colors",
                  )}
                >
                  {rerun.status === "running" ? (
                    <>
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
                      running…
                    </>
                  ) : (
                    <>↻ re-run this query</>
                  )}
                </button>
                {rerun.status === "done" && (
                  <span className="text-[11px] text-neutral-500 tabular-nums">
                    {rerun.data.count} results · {rerun.data.elapsed_ms}ms
                  </span>
                )}
              </div>

              {rerun.status === "done" && (
                <div className="mt-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/70 p-3">
                  {rerun.data.error ? (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400">
                      {rerun.data.error}
                    </div>
                  ) : rerun.data.preview.length === 0 ? (
                    <div className="text-[11px] text-neutral-500">
                      no results — try loosening filters.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {rerun.data.preview.map((p, i) => (
                        <li key={i} className="text-[11px] text-neutral-700 dark:text-neutral-300">
                          <span className="font-medium">{p.name}</span>
                          {p.subtitle ? (
                            <span className="text-neutral-500"> — {p.subtitle}</span>
                          ) : null}
                        </li>
                      ))}
                      {rerun.data.count > rerun.data.preview.length && (
                        <li className="text-[10px] text-neutral-500 italic">
                          +{rerun.data.count - rerun.data.preview.length} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {rerun.status === "error" && (
                <div className="mt-3 text-[11px] text-rose-600 dark:text-rose-400">
                  {rerun.message}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function HowWeSearched({ plans }: HowWeSearchedProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  return (
    <section className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/40 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            transparency
          </div>
          <div className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            how we searched
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {plans.length} Crustdata {plans.length === 1 ? "query" : "queries"} — click to inspect · edit & re-run any step
          </div>
        </div>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.2 }}
          className="text-neutral-500 text-xl font-light select-none"
          aria-hidden
        >
          ›
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="relative px-5 pb-5">
              <div
                className="flex flex-col gap-4 overflow-y-auto pr-1 scroll-py-4"
                style={{ maxHeight: "min(75vh, 720px)" }}
              >
                {plans.map((plan, i) => (
                  <QueryCard key={i} plan={plan} index={i} />
                ))}
              </div>
              {/* bottom fade hint — tells the user there's more to scroll */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-5 bottom-5 h-8 bg-gradient-to-t from-white/80 dark:from-neutral-900/80 to-transparent"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
