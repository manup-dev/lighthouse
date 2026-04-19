"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { MatchedPerson, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { API_BASE } from "@/lib/api";

export interface DraftForgeProps {
  open: boolean;
  person: MatchedPerson;
  track: Track;
  initialDraft: string;
  onClose: () => void;
  onKeep: (newDraft: string) => void;
}

interface RefineResponse {
  variants: string[];
  model: string;
  provider: string;
  elapsed_ms: number;
}

const CHIPS: string[] = [
  "Sharper",
  "Shorter",
  "Reference their recent post",
  "Funnier",
  "Add a specific ask",
  "Softer opener",
];

/**
 * Pull a human-readable error message from a failed FastAPI response.
 * FastAPI HTTPExceptions serialise as {detail: "..."}.
 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown };
    if (typeof data.detail === "string" && data.detail.trim().length > 0) {
      return data.detail;
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`;
}

/** Turn a backend error into something a user can act on. */
function humaniseError(message: string, status: number | null): string {
  const lower = message.toLowerCase();
  if (status === 503 || lower.includes("unreachable")) {
    return "qwen not reachable — start `ollama serve`";
  }
  if (status === 502 || lower.includes("unparseable") || lower.includes("parse")) {
    return "qwen returned something I couldn't parse — try again or rephrase the instruction";
  }
  return message;
}

/** Format ms → `~1.2s`. */
function fmtElapsed(ms: number): string {
  if (ms < 1000) return `~${ms}ms`;
  return `~${(ms / 1000).toFixed(1)}s`;
}

export default function DraftForge({
  open,
  person,
  track,
  initialDraft,
  onClose,
  onKeep,
}: DraftForgeProps) {
  const reduced = useReducedMotion();

  const [workingDraft, setWorkingDraft] = useState<string>(initialDraft);
  const [instruction, setInstruction] = useState<string>("");
  const [variants, setVariants] = useState<string[] | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ elapsed_ms: number; model: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Reset state whenever the modal is re-opened with (possibly) a new draft.
  useEffect(() => {
    if (!open) return;
    setWorkingDraft(initialDraft);
    setInstruction("");
    setVariants(null);
    setSelectedVariant(null);
    setLoading(false);
    setError(null);
    setMeta(null);
  }, [open, initialDraft]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        attemptClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workingDraft, initialDraft]);

  // Cancel any in-flight request on unmount / close.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [open]);

  const dirty = workingDraft !== initialDraft;

  const attemptClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(
        "Close without keeping your changes? Your edited draft will be discarded.",
      );
      if (!ok) return;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    onClose();
  }, [dirty, onClose]);

  const generate = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    // Cancel any prior in-flight call.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setVariants(null);
    setSelectedVariant(null);
    setMeta(null);

    try {
      const res = await fetch(`${API_BASE}/refine-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: workingDraft,
          hook: person.recent_post ?? null,
          instruction: trimmed,
          person: {
            name: person.name,
            title: person.title,
            company: person.company,
            track,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const msg = await readErrorBody(res);
        setError(humaniseError(msg, res.status));
        setLoading(false);
        return;
      }
      const data = (await res.json()) as RefineResponse;
      if (!Array.isArray(data.variants) || data.variants.length === 0) {
        setError("qwen returned no variants — try a different instruction");
      } else {
        setVariants(data.variants);
        setMeta({ elapsed_ms: data.elapsed_ms, model: data.model });
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        // swallow — intentional cancellation
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      // Network-level failure (CORS, DNS, backend down) — likely ollama/api down.
      setError(humaniseError(`unreachable — ${message}`, 503));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [instruction, workingDraft, person, track]);

  const promote = useCallback((idx: number, text: string) => {
    setWorkingDraft(text);
    setSelectedVariant(idx);
  }, []);

  const modalVariants = useMemo(
    () =>
      reduced
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0 },
          }
        : {
            initial: { opacity: 0, scale: 0.96, y: 8 },
            animate: { opacity: 1, scale: 1, y: 0 },
            exit: { opacity: 0, scale: 0.97, y: 4 },
            transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
          },
    [reduced],
  );

  if (!open) return null;

  const canGenerate = instruction.trim().length > 0 && !loading;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="draftforge-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Refine draft for ${person.name}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            // click-outside only when the mousedown originated on the overlay itself.
            if (e.target === e.currentTarget) {
              attemptClose();
            }
          }}
        >
          <motion.div
            key="draftforge-card"
            initial={modalVariants.initial}
            animate={modalVariants.animate}
            exit={modalVariants.exit}
            transition={modalVariants.transition}
            className={clsx(
              "relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto",
              "rounded-2xl border shadow-xl",
              "border-neutral-200 dark:border-neutral-800",
              "bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50",
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 p-5 border-b border-neutral-200 dark:border-neutral-800">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Refine draft</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
                  {person.name}
                  <span className="opacity-60"> · </span>
                  {person.title}
                  {person.company ? (
                    <>
                      <span className="opacity-60"> · </span>
                      {person.company}
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={attemptClose}
                aria-label="close"
                className="shrink-0 rounded-lg w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <span aria-hidden className="text-lg leading-none">×</span>
              </button>
            </div>

            {/* Body: two-column */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
              {/* Left: draft */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="draftforge-draft"
                  className="text-[11px] uppercase tracking-wider text-neutral-500"
                >
                  draft
                </label>
                <textarea
                  id="draftforge-draft"
                  value={workingDraft}
                  onChange={(e) => {
                    setWorkingDraft(e.target.value);
                    // Manual edits break the "promoted variant" visual.
                    setSelectedVariant(null);
                  }}
                  rows={10}
                  className={clsx(
                    "w-full resize-y min-h-[220px] rounded-xl border px-3 py-2 text-sm",
                    "border-neutral-300 dark:border-neutral-700",
                    "bg-white dark:bg-neutral-900",
                    "text-neutral-900 dark:text-neutral-100",
                    "placeholder:text-neutral-400 dark:placeholder:text-neutral-600",
                    "focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100 focus:border-transparent",
                  )}
                  placeholder="Your warm intro draft…"
                />
              </div>

              {/* Right: how to tweak */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="draftforge-instruction"
                  className="text-[11px] uppercase tracking-wider text-neutral-500"
                >
                  how to tweak
                </label>

                {/* Chip row */}
                <div className="flex flex-wrap gap-1.5">
                  {CHIPS.map((chip) => {
                    const active = instruction.trim() === chip;
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setInstruction(chip)}
                        className={clsx(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors",
                          active
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                        )}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>

                <input
                  id="draftforge-instruction"
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canGenerate) {
                      e.preventDefault();
                      generate();
                    }
                  }}
                  placeholder="e.g. lead with a specific metric from their post"
                  className={clsx(
                    "w-full rounded-xl border px-3 py-2 text-sm",
                    "border-neutral-300 dark:border-neutral-700",
                    "bg-white dark:bg-neutral-900",
                    "text-neutral-900 dark:text-neutral-100",
                    "placeholder:text-neutral-400 dark:placeholder:text-neutral-600",
                    "focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100 focus:border-transparent",
                  )}
                />

                <button
                  type="button"
                  onClick={generate}
                  disabled={!canGenerate}
                  className={clsx(
                    "mt-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    "border",
                    canGenerate
                      ? "border-neutral-900 dark:border-neutral-100 bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                      : "border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-600 cursor-not-allowed",
                  )}
                >
                  {loading ? "drafting…" : "✨ Generate 3 variants"}
                </button>
              </div>
            </div>

            {/* Variants area */}
            <div className="px-5 pb-5">
              {loading && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-neutral-500 italic">
                    qwen is drafting… (first call can take 10–15s)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={clsx(
                          "rounded-xl border p-3 h-32 animate-pulse",
                          "border-neutral-200 dark:border-neutral-800",
                          "bg-neutral-100 dark:bg-neutral-900",
                        )}
                      >
                        <div className="h-2.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800 mb-2" />
                        <div className="h-2.5 w-full rounded bg-neutral-200 dark:bg-neutral-800 mb-2" />
                        <div className="h-2.5 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800 mb-2" />
                        <div className="h-2.5 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!loading && error && (
                <div
                  role="alert"
                  className={clsx(
                    "rounded-xl border p-3 flex items-start justify-between gap-3",
                    "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300",
                  )}
                >
                  <div className="text-sm min-w-0">
                    <div className="font-medium">couldn&apos;t refine</div>
                    <div className="opacity-90 break-words">{error}</div>
                  </div>
                  <button
                    type="button"
                    onClick={generate}
                    disabled={!instruction.trim()}
                    className={clsx(
                      "shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                      "border-rose-500/50 hover:bg-rose-500/10",
                      !instruction.trim() && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    retry
                  </button>
                </div>
              )}

              {!loading && !error && variants && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {variants.map((v, i) => {
                    const selected = selectedVariant === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => promote(i, v)}
                        className={clsx(
                          "text-left rounded-xl border p-3 transition-all",
                          "bg-white dark:bg-neutral-900",
                          "hover:shadow-md",
                          selected
                            ? "border-emerald-500 ring-2 ring-emerald-500"
                            : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                            variant {i + 1}
                          </span>
                          {selected && (
                            <span className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                              ✓ promoted
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap line-clamp-[10]">
                          {v}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-neutral-200 dark:border-neutral-800">
              <div className="font-mono text-[11px] text-neutral-500 min-h-[1em]">
                {meta
                  ? `${fmtElapsed(meta.elapsed_ms)} · local ${meta.model} · ₹0`
                  : ""}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWorkingDraft(initialDraft);
                    setSelectedVariant(null);
                  }}
                  disabled={!dirty}
                  className={clsx(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    dirty
                      ? "border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      : "border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed",
                  )}
                >
                  Revert
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onKeep(workingDraft);
                    onClose();
                  }}
                  className={clsx(
                    "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
                    "border-neutral-900 dark:border-neutral-100 bg-neutral-900 text-white hover:bg-neutral-700",
                    "dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
                  )}
                >
                  Keep
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
