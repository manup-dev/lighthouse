"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useReducedMotion } from "@/lib/useReducedMotion";

export interface RotatingWordProps {
  words: string[];
  /** ms per word */
  interval?: number;
  className?: string;
}

/**
 * Slot-machine-style word rotator. Pauses when the tab is hidden or on hover.
 * Width auto-fits the widest word so the surrounding text doesn't reflow.
 */
export default function RotatingWord({
  words,
  interval = 2600,
  className,
}: RotatingWordProps) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || paused || words.length <= 1) return;
    timerRef.current = window.setInterval(() => {
      setI((n) => (n + 1) % words.length);
    }, interval);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [reduced, paused, words.length, interval]);

  useEffect(() => {
    function onVis() {
      setPaused(document.hidden);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const current = words[i] ?? words[0];
  // Reserve width of the widest word so the H1 doesn't shift.
  const widest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        "relative inline-block align-baseline",
        "text-amber-500",
        className,
      )}
      // aria-live so screen readers announce changes without visual duplicates.
      aria-live="polite"
    >
      {/* invisible sizer — longest word, holds width */}
      <span aria-hidden className="invisible whitespace-nowrap">
        {widest}
      </span>
      <span className="absolute inset-0 inline-flex items-baseline whitespace-nowrap overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={current}
            initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: "0.6em" }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: "-0.6em" }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
            }
            className="inline-block"
          >
            {current}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
