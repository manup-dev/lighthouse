"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import type { LogEvent, PipelineStage } from "@/lib/types";

export interface LogLine extends LogEvent {
  id: number;
  ts: number;
}

interface Props {
  logs: LogLine[];
  running: boolean;
}

const STAGE_COLOUR: Record<PipelineStage, string> = {
  analyzer: "text-sky-400",
  thesis: "text-amber-400",
  query_plan: "text-fuchsia-400",
  crust_fanout: "text-emerald-400",
  ranker: "text-violet-400",
  enricher: "text-cyan-400",
  outreach: "text-rose-400",
  pipeline: "text-neutral-400",
};

const LEVEL_PREFIX: Record<LogEvent["level"], string> = {
  info: "·",
  warn: "!",
  error: "✗",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getMinutes().toString().padStart(2, "0")}:${d
    .getSeconds()
    .toString()
    .padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0").slice(0, 2)}`;
}

export default function LogConsole({ logs, running }: Props) {
  const [open, setOpen] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Toggle with `?` hotkey (single key, no modifier) — classic dev-tools feel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll to bottom as new lines arrive, unless the user scrolled up.
  useEffect(() => {
    if (!open || !stickToBottom) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, open, stickToBottom]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(gap < 24);
  }

  if (logs.length === 0 && !running) return null;

  return (
    <div className="fixed left-0 right-0 bottom-0 z-30 pointer-events-none">
      <div className="max-w-5xl mx-auto px-6 pb-4 pointer-events-auto">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/95 backdrop-blur shadow-2xl overflow-hidden font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-neutral-300 hover:bg-neutral-900 transition-colors"
            aria-expanded={open}
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "inline-block h-2 w-2 rounded-full",
                  running
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-neutral-600",
                )}
                aria-hidden
              />
              <span className="uppercase tracking-[0.18em] text-[10px] text-neutral-400">
                backend trace
              </span>
              <span className="text-neutral-500 tabular-nums">
                {logs.length} lines
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-neutral-500">
                <kbd className="px-1 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-400">
                  ?
                </kbd>{" "}
                to toggle
              </span>
              <span className="text-neutral-400">{open ? "▾" : "▸"}</span>
            </div>
          </button>

          {open && (
            <div
              ref={scrollerRef}
              onScroll={onScroll}
              className="max-h-64 overflow-y-auto px-3 py-2 space-y-0.5 bg-neutral-950"
            >
              {logs.length === 0 ? (
                <div className="text-neutral-500 italic">
                  waiting for trace…
                </div>
              ) : (
                logs.map((l) => (
                  <div
                    key={l.id}
                    className={clsx(
                      "flex gap-2 leading-snug",
                      l.level === "warn"
                        ? "text-amber-300"
                        : l.level === "error"
                        ? "text-rose-300"
                        : "text-neutral-200",
                    )}
                  >
                    <span className="text-neutral-600 tabular-nums shrink-0">
                      {formatTs(l.ts)}
                    </span>
                    <span
                      className={clsx(
                        "shrink-0 w-24 truncate",
                        l.stage
                          ? STAGE_COLOUR[l.stage]
                          : "text-neutral-500",
                      )}
                    >
                      {l.stage ?? "—"}
                    </span>
                    <span className="shrink-0 text-neutral-600">
                      {LEVEL_PREFIX[l.level]}
                    </span>
                    <span className="whitespace-pre-wrap break-words">
                      {l.message}
                    </span>
                  </div>
                ))
              )}
              {!stickToBottom && (
                <button
                  type="button"
                  onClick={() => {
                    setStickToBottom(true);
                    const el = scrollerRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                  className="sticky bottom-0 left-full text-[10px] text-amber-400 hover:text-amber-300 bg-neutral-900/90 rounded px-2 py-0.5"
                >
                  jump to latest ↓
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
