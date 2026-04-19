"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import clsx from "clsx";
import type { CrustQueryPlan, Track } from "@/lib/types";

export interface HowWeSearchedProps {
  plans: CrustQueryPlan[];
}

const TRACK_COLORS: Record<Track, string> = {
  investor: "text-sky-600 dark:text-sky-400",
  design_partner: "text-violet-600 dark:text-violet-400",
  talent: "text-emerald-600 dark:text-emerald-400",
};

const TRACK_LABEL: Record<Track, string> = {
  investor: "investor",
  design_partner: "design_partner",
  talent: "talent",
};

export default function HowWeSearched({ plans }: HowWeSearchedProps) {
  const [open, setOpen] = useState(false);

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
            {plans.length} Crustdata {plans.length === 1 ? "query" : "queries"} — click to inspect
          </div>
        </div>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 flex flex-col gap-4 max-h-[520px] overflow-y-auto">
              {plans.map((plan, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60"
                >
                  <header className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-center gap-3">
                      <span
                        className={clsx(
                          "text-[10px] uppercase tracking-widest font-semibold",
                          TRACK_COLORS[plan.track],
                        )}
                      >
                        {TRACK_LABEL[plan.track]}
                      </span>
                      <code className="text-xs text-neutral-700 dark:text-neutral-300">
                        {plan.endpoint}
                      </code>
                    </div>
                    <span className="text-[10px] text-neutral-500">#{i + 1}</span>
                  </header>
                  <p className="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400 italic border-b border-neutral-200 dark:border-neutral-800">
                    {plan.rationale}
                  </p>
                  <pre className="px-4 py-3 text-[11px] leading-relaxed font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto">
{JSON.stringify(plan.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
