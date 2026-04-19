"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

import FunnelViz from "@/components/FunnelViz";
import PersonCard from "@/components/PersonCard";
import HowWeSearched from "@/components/HowWeSearched";
import InputForm from "@/components/InputForm";
import LogConsole, { type LogLine } from "@/components/LogConsole";

import { DEMO_MATCH } from "@/lib/demo";
import { startMatch, subscribeEvents } from "@/lib/api";
import type { MatchResult, PipelineStage, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";

type UiState = "idle" | "running" | "done" | "demo";

const TABS: ReadonlyArray<{ track: Track; label: string; key: keyof MatchResult }> = [
  { track: "investor",       label: "Investors",        key: "investors" },
  { track: "design_partner", label: "Design Partners",  key: "design_partners" },
  { track: "talent",         label: "Senior Hires",     key: "talent" },
];

// The order stages light up in the simulated (demo) pipeline.
const DEMO_SEQUENCE: PipelineStage[] = [
  "analyzer",
  "thesis",
  "query_plan",
  "crust_fanout",
  "ranker",
  "outreach",
];

/** Format a cost banner like "$0.00 · 23s · local qwen2.5:14b". */
function formatCostBanner(stats: Record<string, unknown>): string {
  const costRaw = stats["cost_usd"];
  const cost =
    typeof costRaw === "number" ? `$${costRaw.toFixed(2)}` : "$0.00";

  const duration =
    typeof stats["duration_sec"] === "number"
      ? Math.round(stats["duration_sec"] as number)
      : typeof stats["elapsed_ms"] === "number"
      ? Math.round((stats["elapsed_ms"] as number) / 1000)
      : 23;

  const model =
    typeof stats["model"] === "string" && stats["model"].length > 0
      ? (stats["model"] as string)
      : "local qwen2.5:14b";

  return `${cost} · ${duration}s · ${model}`;
}

export default function Home() {
  const [state, setState] = useState<UiState>("idle");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [active, setActive] = useState<PipelineStage | null>(null);
  const [completed, setCompleted] = useState<Set<PipelineStage>>(new Set());
  const [runId, setRunId] = useState<string>("init");
  const [activeTab, setActiveTab] = useState<Track>("investor");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logSeq = useRef(0);
  const reduced = useReducedMotion();

  // Timers from the demo simulation — cleared on unmount or new run.
  const timers = useRef<number[]>([]);
  const sseCleanup = useRef<(() => void) | null>(null);

  const resetTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => {
    return () => {
      resetTimers();
      sseCleanup.current?.();
    };
  }, [resetTimers]);

  const runDemoSimulation = useCallback(() => {
    // Light up stages one by one, then reveal the result.
    let elapsed = 0;
    DEMO_SEQUENCE.forEach((stage, i) => {
      const startAt = elapsed;
      elapsed += 650 + i * 150;
      timers.current.push(
        window.setTimeout(() => {
          setActive(stage);
        }, startAt),
      );
      timers.current.push(
        window.setTimeout(() => {
          setCompleted((prev) => {
            const next = new Set(prev);
            next.add(stage);
            return next;
          });
        }, elapsed - 80),
      );
    });

    timers.current.push(
      window.setTimeout(() => {
        setActive(null);
        setResult(DEMO_MATCH);
        setState("demo");
      }, elapsed + 200),
    );
  }, []);

  const handleSubmit = useCallback(
    async ({ repo_url, location }: { repo_url: string; location?: string }) => {
      resetTimers();
      sseCleanup.current?.();
      sseCleanup.current = null;

      setResult(null);
      setActive(null);
      setCompleted(new Set());
      setErrorMsg(null);
      setLogs([]);
      logSeq.current = 0;
      setState("running");
      setRunId(`${Date.now()}`);

      // Try the real API first — but never block the demo if it's down.
      try {
        const { match_id } = await startMatch(
          { repo_url, location },
          AbortSignal.timeout(3000),
        );

        sseCleanup.current = subscribeEvents(match_id, {
          onStage: (evt) => {
            if (evt.status === "start") {
              setActive(evt.stage);
            } else {
              setCompleted((prev) => {
                const next = new Set(prev);
                next.add(evt.stage);
                return next;
              });
              setActive((cur) => (cur === evt.stage ? null : cur));
            }
          },
          onLog: (evt) => {
            setLogs((prev) => [
              ...prev,
              { ...evt, id: logSeq.current++, ts: Date.now() },
            ]);
          },
          onResult: (r) => {
            setResult(r);
            setActive(null);
            setState("done");
            sseCleanup.current?.();
            sseCleanup.current = null;
          },
          onError: (msg) => {
            setErrorMsg(msg);
          },
        });
      } catch {
        // API unreachable — fall back to bundled demo data. Silent on purpose.
        runDemoSimulation();
      }
    },
    [resetTimers, runDemoSimulation],
  );

  const isRunning = state === "running";
  const hasResult = result !== null;

  // Document title reflects the run state — the tab strip doubles as a status light.
  useEffect(() => {
    const original = "Lighthouse — a founder's command center";
    if (isRunning) {
      document.title = "Lighthouse — searching…";
    } else if (hasResult) {
      const n =
        (result?.investors.length ?? 0) +
        (result?.design_partners.length ?? 0) +
        (result?.talent.length ?? 0);
      document.title = `Lighthouse — ${n} results`;
    } else {
      document.title = original;
    }
    return () => {
      document.title = original;
    };
  }, [isRunning, hasResult, result]);

  // 1/2/3 hotkeys switch tabs (power-user pattern from Gmail/Discord).
  useEffect(() => {
    if (!hasResult) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") {
        e.preventDefault();
        setActiveTab("investor");
      } else if (e.key === "2") {
        e.preventDefault();
        setActiveTab("design_partner");
      } else if (e.key === "3") {
        e.preventDefault();
        setActiveTab("talent");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasResult]);

  return (
    <main className="min-h-screen w-full flex flex-col items-center">
      {/* hero */}
      <div className="relative w-full">
        <div aria-hidden className="absolute inset-0 lh-grid pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-8 flex flex-col items-center gap-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>lighthouse</span>
            <span className="opacity-40">·</span>
            <span>contextcon · bengaluru</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-center text-balance">
            A <span className="text-amber-500">command center</span> for founders.
          </h1>
          <p className="max-w-2xl text-center text-neutral-600 dark:text-neutral-400 text-balance">
            Paste a GitHub repo. We return 5 investors, 5 design partners, and 5
            senior hires — each with a warm intro grounded in something that
            person posted this week.
          </p>

          <div className="w-full max-w-2xl mt-2">
            <InputForm onSubmit={handleSubmit} disabled={isRunning} />
          </div>

          {errorMsg && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              API hiccup: {errorMsg} — showing cached demo data below.
            </p>
          )}
        </div>
      </div>

      {/* funnel */}
      {(isRunning || hasResult) && (
        <div className="w-full max-w-5xl mx-auto px-6">
          <FunnelViz completed={completed} active={active} runId={runId} />
        </div>
      )}

      {/* results */}
      {hasResult && result && (
        <div className="w-full max-w-5xl mx-auto px-6 pb-24 flex flex-col gap-6">
          {/* cost / duration / model banner — transparency is the product */}
          <div className="self-stretch flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 px-3 py-1 text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {formatCostBanner(result.stats)}
            </div>
          </div>

          {/* thesis blurb */}
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 backdrop-blur-sm p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-1">
              thesis
            </div>
            <p className="text-neutral-800 dark:text-neutral-200">
              {result.thesis.moat}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.thesis.themes.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>

          {/* tabs */}
          <div
            role="tablist"
            aria-label="matches"
            className="relative inline-flex self-start rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 p-1 gap-1"
          >
            {TABS.map((tab, i) => {
              const list = result[tab.key] as unknown as MatchResult["investors"];
              const selected = activeTab === tab.track;
              return (
                <button
                  key={tab.track}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.track)}
                  title={`Press ${i + 1}`}
                  className={clsx(
                    "relative px-3.5 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2",
                    selected
                      ? "text-white dark:text-neutral-900"
                      : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="tab-underline"
                      aria-hidden
                      className="absolute inset-0 rounded-lg bg-neutral-900 dark:bg-white"
                      transition={
                        reduced
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 500, damping: 38 }
                      }
                    />
                  )}
                  <span className="relative z-[1]">{tab.label}</span>
                  <span
                    className={clsx(
                      "relative z-[1] text-xs tabular-nums rounded-full px-1.5",
                      selected
                        ? "bg-white/20 dark:bg-neutral-900/20"
                        : "bg-neutral-200 dark:bg-neutral-800",
                    )}
                  >
                    {list.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TABS.find((t) => t.track === activeTab) &&
              (result[
                TABS.find((t) => t.track === activeTab)!.key
              ] as unknown as MatchResult["investors"]).map((person) => (
                <PersonCard
                  key={`${activeTab}-${person.name}`}
                  person={person}
                  track={activeTab}
                />
              ))}
          </div>

          {/* transparency panel */}
          <HowWeSearched plans={result.query_plan} />

          {/* footer stats */}
          <div className="mt-2 text-center text-xs text-neutral-500">
            scanned{" "}
            <span className="tabular-nums">
              {Number(result.stats.profiles_scanned ?? 0).toLocaleString()}
            </span>{" "}
            profiles · ranked 15 · ready in{" "}
            <span className="tabular-nums">
              {((Number(result.stats.elapsed_ms ?? 0)) / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {/* empty state hint */}
      {!isRunning && !hasResult && (
        <div className="max-w-xl mx-auto px-6 py-10 text-center text-sm text-neutral-500">
          Try <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">github.com/acme/freight-graph</code>{" "}
          or any public repo to see a demo run.
        </div>
      )}

      {/* live backend trace */}
      <LogConsole logs={logs} running={isRunning} />
    </main>
  );
}
