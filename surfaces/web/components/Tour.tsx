"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";

import { useReducedMotion } from "@/lib/useReducedMotion";

const STORAGE_KEY = "lighthouse:tour:v1:seen";
const START_EVENT = "lighthouse:tour:start";

type Placement = "bottom" | "top" | "center";

interface Step {
  id: string;
  anchor?: string; // CSS selector — if missing/unmatched, falls back to centered.
  title: string;
  body: string;
  placement?: Placement;
  kbd?: string;
}

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to Lighthouse",
    body:
      "A founder's command center. Paste a GitHub repo and get 15 warm-intro targets — investors, design partners, senior hires — grounded in what they posted this week. Ready for a quick tour?",
    placement: "center",
  },
  {
    id: "input",
    anchor: '[data-tour="input"]',
    title: "Start with a repo",
    body:
      "Any public GitHub URL works. Press / to focus this field anytime, or click the dotted sample to try it on Lighthouse itself.",
    placement: "bottom",
    kbd: "/",
  },
  {
    id: "trace",
    anchor: '[data-tour="input"]',
    title: "Every Claude call is visible",
    body:
      "A live trace at the bottom-right shows each LLM call as it happens — thesis, query plan, ranker, outreach. No black-box reasoning.",
    placement: "bottom",
  },
  {
    id: "samples",
    anchor: '[data-tour="samples"]',
    title: "Or open a baked sample",
    body:
      "Don't want to wait? Any sample below drops you straight into a full tri-fold result — same UI, same cards, same drafts — so you can see what a run looks like.",
    placement: "top",
  },
  {
    id: "tracks",
    title: "Three tracks, one input",
    body:
      "Results land as tabs: Investors · Design Partners · Senior Hires. Press 1 / 2 / 3 to jump between them. Each card cites a specific recent post.",
    placement: "center",
    kbd: "1 · 2 · 3",
  },
  {
    id: "handoff",
    title: "Refine & hand off",
    body:
      "Every card has a draft you can Refine (local Qwen) or hand off to Claude Code as a ready-to-paste prompt. Contact history lives in localStorage — zero server-side PII.",
    placement: "center",
  },
  {
    id: "done",
    title: "You're set.",
    body:
      "Replay this tour anytime from the ? button in the top-right. Happy scouting.",
    placement: "center",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string): Rect | null {
  if (typeof window === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function Tour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const rafRef = useRef<number | null>(null);

  // First-visit auto-open + manual-start event subscription.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      /* localStorage blocked — act as if unseen, never persist. */
    }
    if (!seen) {
      // Small delay so the hero has a chance to paint first.
      const id = window.setTimeout(() => {
        setIndex(0);
        setOpen(true);
      }, 700);
      return () => window.clearTimeout(id);
    }
  }, []);

  useEffect(() => {
    function onStart() {
      setIndex(0);
      setOpen(true);
    }
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  const step = STEPS[index];

  const recompute = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    if (!step?.anchor) {
      setRect(null);
      return;
    }
    setRect(getRect(step.anchor));
  }, [step]);

  // Recompute on step change, resize, and scroll — with a scheduled retry
  // in case the anchor mounts a tick after the step starts.
  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    // Retry a few times in case the anchor is still rendering (e.g. after scroll).
    let tries = 0;
    const timer = window.setInterval(() => {
      recompute();
      tries += 1;
      if (tries > 6) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [open, index, recompute]);

  useEffect(() => {
    if (!open) return;
    function onResizeOrScroll() {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    }
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open, recompute]);

  // Scroll the anchor into view when the step activates.
  useEffect(() => {
    if (!open || !step?.anchor) return;
    const el = document.querySelector(step.anchor) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [open, step, reduced]);

  // Keyboard: arrows + Enter + Esc.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* no-op */
    }
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  const next = useCallback(() => {
    if (index >= STEPS.length - 1) {
      dismiss();
      return;
    }
    setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [index, dismiss]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  if (!open || !step) return null;

  const pad = 10;
  const spotlight =
    rect != null
      ? {
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }
      : null;

  const tooltipStyle = getTooltipStyle(spotlight, step.placement ?? "bottom", viewport);

  return (
    <AnimatePresence>
      <motion.div
        key="tour"
        className="fixed inset-0 z-[60] pointer-events-auto"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lh-tour-title"
      >
        {/* dim + spotlight via SVG mask */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full"
          width={viewport.w || "100%"}
          height={viewport.h || "100%"}
        >
          <defs>
            <mask id="lh-tour-mask">
              <rect width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.left}
                  y={spotlight.top}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx={14}
                  ry={14}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(10, 12, 18, 0.62)"
            mask="url(#lh-tour-mask)"
            onClick={dismiss}
          />
          {spotlight && (
            <rect
              x={spotlight.left}
              y={spotlight.top}
              width={spotlight.width}
              height={spotlight.height}
              rx={14}
              ry={14}
              fill="none"
              stroke="rgba(251, 191, 36, 0.85)"
              strokeWidth={2}
              className="pointer-events-none"
            />
          )}
        </svg>

        {/* tooltip card */}
        <motion.div
          key={step.id}
          initial={reduced ? false : { opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={clsx(
            "absolute max-w-sm w-[min(92vw,24rem)] rounded-2xl",
            "border border-neutral-200 dark:border-neutral-800",
            "bg-white dark:bg-neutral-950 shadow-2xl backdrop-blur-md",
            "p-5 flex flex-col gap-3",
          )}
          style={tooltipStyle}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.22em] text-amber-500 font-semibold">
              Tour · {index + 1} / {STEPS.length}
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline decoration-dotted underline-offset-4"
            >
              skip
            </button>
          </div>
          <h2
            id="lh-tour-title"
            className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            {step.title}
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
            {step.body}
          </p>
          {step.kbd && (
            <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
              <span>shortcut</span>
              <kbd className="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 font-mono text-[10px]">
                {step.kbd}
              </kbd>
            </div>
          )}

          {/* dot pager */}
          <div className="flex items-center gap-1.5 pt-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Step ${i + 1}`}
                onClick={() => setIndex(i)}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  i === index
                    ? "w-6 bg-amber-500"
                    : "w-1.5 bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400",
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              className={clsx(
                "text-sm px-3 py-1.5 rounded-lg border transition-colors",
                "border-neutral-300 dark:border-neutral-700",
                "text-neutral-700 dark:text-neutral-300",
                "enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className={clsx(
                "text-sm font-semibold px-4 py-1.5 rounded-lg",
                "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
                "hover:-translate-y-[1px] hover:shadow-md transition-all",
              )}
            >
              {index === STEPS.length - 1 ? "Got it" : "Next"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Trigger the tour from anywhere (e.g. TopNav "?" button). */
export function startTour() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("lighthouse:tour:start"));
}

/** Place the tooltip relative to the spotlight, clamped to the viewport. */
function getTooltipStyle(
  spotlight: Rect | null,
  placement: Placement,
  viewport: { w: number; h: number },
): React.CSSProperties {
  const margin = 16;
  const cardW = Math.min(384, (viewport.w || 384) - 32);
  const estH = 260;

  if (!spotlight || placement === "center" || viewport.w === 0) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  let top: number;
  if (placement === "top") {
    top = spotlight.top - estH - margin;
    if (top < 16) top = spotlight.top + spotlight.height + margin;
  } else {
    top = spotlight.top + spotlight.height + margin;
    if (top + estH > viewport.h - 16) top = spotlight.top - estH - margin;
  }
  top = Math.max(16, Math.min(top, viewport.h - estH - 16));

  const spotlightCenter = spotlight.left + spotlight.width / 2;
  let left = spotlightCenter - cardW / 2;
  left = Math.max(16, Math.min(left, viewport.w - cardW - 16));

  return { left, top };
}
