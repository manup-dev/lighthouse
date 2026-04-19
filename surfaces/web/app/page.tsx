"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";

import FunnelViz from "@/components/FunnelViz";
import MissionCard from "@/components/MissionCard";
import CommandCenterStrip from "@/components/CommandCenterStrip";
import DraftForge from "@/components/DraftForge";
import HowWeSearched from "@/components/HowWeSearched";
import InputForm from "@/components/InputForm";
import LogConsole, { type LogLine } from "@/components/LogConsole";
import QueueWait from "@/components/QueueWait";
import RunBanner from "@/components/RunBanner";
import TopNav from "@/components/TopNav";
import RotatingWord from "@/components/RotatingWord";
import Logo from "@/components/Logo";

import { DEMO_MATCH } from "@/lib/demo";
import {
  QueueFullError,
  startMatch,
  subscribeEvents,
  type GalleryItem,
  type QueueState,
} from "@/lib/api";
import { buildHandoffPrompt } from "@/lib/handoff";
import { missionKey, useMissionStore } from "@/lib/mission";
import type { MatchedPerson, MatchResult, PipelineStage, Track } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";

type UiState = "idle" | "queued" | "running" | "done" | "demo" | "gallery";

const TABS: ReadonlyArray<{ track: Track; label: string; key: keyof MatchResult }> = [
  { track: "investor",       label: "Investors",        key: "investors" },
  { track: "design_partner", label: "Design Partners",  key: "design_partners" },
  { track: "talent",         label: "Senior Hires",     key: "talent" },
];

// Order tracks are revealed to the user once a result lands.
// "Investors first" — founders want the money signal before anything else.
const REVEAL_ORDER: Track[] = ["investor", "design_partner", "talent"];

// Suffix the period inside each variant so the dot tracks the word
// instead of sitting at the end of the (longest-word) sizer slot.
const HERO_WORDS = ["founders.", "recruiters.", "scouts.", "operators."];

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
  // Refine-draft modal + handoff toast + in-memory draft overrides
  const [forgePerson, setForgePerson] = useState<MatchedPerson | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [handoffToast, setHandoffToast] = useState<string | null>(null);
  const mission = useMissionStore();
  // Tracks that have been progressively "revealed" after a result arrives.
  const [readyTracks, setReadyTracks] = useState<Set<Track>>(new Set());
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission | "unsupported">(
    () => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
      }
      return Notification.permission;
    },
  );
  const [notifyPending, setNotifyPending] = useState(false);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [galleryOnly, setGalleryOnly] = useState(false);
  const [sampleMeta, setSampleMeta] = useState<GalleryItem | null>(null);
  const logSeq = useRef(0);
  const reduced = useReducedMotion();

  // Timers from the demo simulation — cleared on unmount or new run.
  const timers = useRef<number[]>([]);
  const revealTimers = useRef<number[]>([]);
  const sseCleanup = useRef<(() => void) | null>(null);

  const resetTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    revealTimers.current.forEach((id) => window.clearTimeout(id));
    revealTimers.current = [];
  }, []);

  useEffect(() => {
    return () => {
      resetTimers();
      sseCleanup.current?.();
    };
  }, [resetTimers]);

  // Stagger reveal of the three tracks once a result arrives.
  // Investors first — the most load-bearing track for founders.
  const scheduleProgressiveReveal = useCallback(() => {
    setReadyTracks(new Set());
    // Instant if reduced-motion.
    if (reduced) {
      setReadyTracks(new Set(REVEAL_ORDER));
      return;
    }
    const step = 550;
    REVEAL_ORDER.forEach((track, i) => {
      revealTimers.current.push(
        window.setTimeout(() => {
          setReadyTracks((prev) => {
            const next = new Set(prev);
            next.add(track);
            return next;
          });
        }, i * step),
      );
    });
  }, [reduced]);

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
        scheduleProgressiveReveal();
      }, elapsed + 200),
    );
  }, [scheduleProgressiveReveal]);

  const handleSubmit = useCallback(
    async ({
      repo_url,
      location,
      user_hint,
    }: {
      repo_url: string;
      location?: string;
      user_hint?: string;
    }) => {
      resetTimers();
      sseCleanup.current?.();
      sseCleanup.current = null;

      setResult(null);
      setActive(null);
      setCompleted(new Set());
      setReadyTracks(new Set());
      setErrorMsg(null);
      setLogs([]);
      setQueueState(null);
      setGalleryOnly(false);
      setSampleMeta(null);
      logSeq.current = 0;
      setState("queued"); // optimistic — SSE queue events will either keep us here or flip to running
      setRunStartedAt(Date.now());
      setRunId(`${Date.now()}`);

      // Try the real API first — but never block the demo if it's down.
      try {
        const { match_id, queue } = await startMatch(
          { repo_url, location, user_hint },
          AbortSignal.timeout(3000),
        );
        if (queue) setQueueState(queue);

        sseCleanup.current = subscribeEvents(match_id, {
          onQueue: (q) => {
            setQueueState(q);
            setState(q.position <= 0 ? "running" : "queued");
          },
          onStage: (evt) => {
            // First stage event means the pipeline actually started running.
            setState("running");
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
            scheduleProgressiveReveal();
            sseCleanup.current?.();
            sseCleanup.current = null;
            // Fire a browser notification if the user opted in and the tab isn't focused.
            if (
              typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "granted" &&
              document.visibilityState !== "visible"
            ) {
              const total =
                r.investors.length + r.design_partners.length + r.talent.length;
              try {
                new Notification("Lighthouse — research ready", {
                  body: `${total} matches across investors, design partners & senior hires.`,
                  tag: "lighthouse-done",
                });
              } catch {
                /* ignore — some browsers throw on missing icon etc. */
              }
            }
          },
          onError: (msg) => {
            setErrorMsg(msg);
          },
        });
      } catch (e) {
        if (e instanceof QueueFullError) {
          // Demo is slammed — flip into gallery-only mode so the user still
          // sees something useful instead of a raw error.
          setGalleryOnly(true);
          setState("gallery");
          return;
        }
        // API unreachable — fall back to bundled demo data. Silent on purpose.
        runDemoSimulation();
      }
    },
    [resetTimers, runDemoSimulation, scheduleProgressiveReveal],
  );

  const handleOpenSample = useCallback(
    (match: MatchResult, meta: GalleryItem) => {
      resetTimers();
      sseCleanup.current?.();
      sseCleanup.current = null;
      setResult(match);
      setSampleMeta(meta);
      setErrorMsg(null);
      setQueueState(null);
      setActive(null);
      setCompleted(new Set(DEMO_SEQUENCE)); // a baked run is a "done" pipeline
      setState("done");
      scheduleProgressiveReveal();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [resetTimers, scheduleProgressiveReveal],
  );

  const isRunning = state === "running";
  const isQueued = state === "queued";
  const isGalleryOnly = state === "gallery";
  const hasResult = result !== null;

  const requestNotifyPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") {
      setNotifyPerm(Notification.permission);
      return;
    }
    setNotifyPending(true);
    try {
      const perm = await Notification.requestPermission();
      setNotifyPerm(perm);
    } finally {
      setNotifyPending(false);
    }
  }, []);

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

  const currentCards = useMemo(() => {
    if (!result) return [];
    const tab = TABS.find((t) => t.track === activeTab);
    if (!tab) return [];
    const raw = result[tab.key] as unknown as MatchResult["investors"];
    // Apply in-memory draft overrides from DraftForge "Keep" without mutating the server result.
    return raw.map((p) => {
      const key = missionKey(p);
      const override = draftOverrides[key];
      return override ? { ...p, warm_intro_draft: override } : p;
    });
  }, [result, activeTab, draftOverrides]);

  const handleRefine = useCallback((person: MatchedPerson) => {
    setForgePerson(person);
  }, []);

  const handleForgeKeep = useCallback(
    (newDraft: string) => {
      if (!forgePerson) return;
      const key = missionKey(forgePerson);
      setDraftOverrides((prev) => ({ ...prev, [key]: newDraft }));
      mission.addDraft(key, newDraft);
      mission.advance(key, "refined");
      setForgePerson(null);
    },
    [forgePerson, mission],
  );

  const handleHandoff = useCallback(
    async (person: MatchedPerson) => {
      const key = missionKey(person);
      const draft = draftOverrides[key] ?? person.warm_intro_draft;
      const prompt = buildHandoffPrompt({
        person,
        track: activeTab,
        draft,
        repoUrl: result?.repo_url,
      });
      try {
        await navigator.clipboard.writeText(prompt);
        setHandoffToast(`Handoff copied — paste into Claude Code (${person.name})`);
      } catch {
        setHandoffToast("Clipboard blocked — select the text in the console to copy");
        // eslint-disable-next-line no-console
        console.log("[lighthouse handoff]", prompt);
      }
      window.setTimeout(() => setHandoffToast(null), 4000);
    },
    [activeTab, draftOverrides, result?.repo_url],
  );

  const activeReady = readyTracks.has(activeTab);

  return (
    <main className="min-h-screen w-full flex flex-col items-center">
      <TopNav />

      {/* hero */}
      <div className="relative w-full">
        <div aria-hidden className="absolute inset-0 lh-beacon pointer-events-none" />
        <div aria-hidden className="absolute inset-0 lh-grid pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-6 pt-14 sm:pt-20 pb-10 flex flex-col items-center gap-6">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <Logo size={16} beam={false} className="text-neutral-500" />
            <span>a founder&rsquo;s command center</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight text-center text-balance leading-[1.05]">
            Warm intros, grounded in what they
            <br className="hidden sm:block" />{" "}
            posted this week —{" "}
            <span className="whitespace-nowrap">
              for{" "}
              <RotatingWord
                words={HERO_WORDS}
                className="text-amber-500 font-semibold"
              />
            </span>
          </h1>
          <p className="max-w-2xl text-center text-neutral-600 dark:text-neutral-400 text-balance">
            Paste a GitHub repo. We return{" "}
            <span className="text-neutral-900 dark:text-neutral-200 font-medium">5 investors</span>,{" "}
            <span className="text-neutral-900 dark:text-neutral-200 font-medium">5 design partners</span>, and{" "}
            <span className="text-neutral-900 dark:text-neutral-200 font-medium">5 senior hires</span> — each with a recent-post angle you can use.
          </p>

          <div className="w-full max-w-2xl mt-2">
            <InputForm onSubmit={handleSubmit} disabled={isRunning} />
          </div>

          <RunBanner
            running={isRunning}
            startedAt={runStartedAt}
            notifyPermission={notifyPerm}
            onRequestNotify={requestNotifyPermission}
            notifyPending={notifyPending}
          />

          {sampleMeta && hasResult && (
            <div className="w-full max-w-2xl -mt-2 mb-1">
              <div className="text-xs text-neutral-500 text-center">
                showing a baked sample run for{" "}
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {sampleMeta.display_name}
                </span>{" "}
                — submit a repo above to start your own.
              </div>
            </div>
          )}

          {errorMsg && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              API hiccup: {errorMsg} — showing cached demo data below.
            </p>
          )}
        </div>
      </div>

      {/* queue wait — gallery while user is queued or when demo is slammed */}
      {(isQueued || isGalleryOnly) && (
        <QueueWait
          position={queueState?.position ?? 0}
          depth={queueState?.depth ?? 0}
          etaSec={queueState?.eta_sec ?? 0}
          galleryOnly={isGalleryOnly}
          onOpenSample={handleOpenSample}
        />
      )}

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

          {/* outreach command center — lifecycle counts across all 15 cards */}
          <div className="self-stretch flex justify-center">
            <CommandCenterStrip />
          </div>

          {/* thesis blurb */}
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/40 backdrop-blur-sm p-5 shadow-sm">
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
              const ready = readyTracks.has(tab.track);
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
                      "relative z-[1] text-xs tabular-nums rounded-full px-1.5 inline-flex items-center gap-1",
                      selected
                        ? "bg-white/20 dark:bg-neutral-900/20"
                        : "bg-neutral-200 dark:bg-neutral-800",
                    )}
                  >
                    {!ready && (
                      <span
                        aria-hidden
                        className={clsx(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          selected
                            ? "bg-white/80 dark:bg-neutral-900/70"
                            : "bg-amber-400",
                          !reduced && "animate-pulse",
                        )}
                      />
                    )}
                    {list.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* cards grid — staggered reveal + per-tab fade */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {activeReady ? (
                currentCards.map((person, i) => (
                  <motion.div
                    key={`${activeTab}-${person.name}`}
                    initial={reduced ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : {
                            duration: 0.35,
                            delay: i * 0.06,
                            ease: [0.22, 1, 0.36, 1],
                          }
                    }
                  >
                    <MissionCard
                      person={person}
                      track={activeTab}
                      onRefine={handleRefine}
                      onHandoff={handleHandoff}
                    />
                  </motion.div>
                ))
              ) : (
                <TrackSkeleton />
              )}
            </motion.div>
          </AnimatePresence>

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

      {/* empty state — show baked gallery so the landing page is never empty */}
      {!isRunning && !isQueued && !isGalleryOnly && !hasResult && (
        <>
          <div className="max-w-xl mx-auto px-6 pt-6 pb-2 text-center text-sm text-neutral-500">
            Try <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">github.com/acme/freight-graph</code>{" "}
            or any public repo — or explore a baked sample ↓
          </div>
          <QueueWait
            position={0}
            depth={0}
            etaSec={0}
            mode="idle"
            onOpenSample={handleOpenSample}
          />
        </>
      )}

      {/* live backend trace */}
      <LogConsole logs={logs} running={isRunning} />

      {/* draft refine modal */}
      {forgePerson && (
        <DraftForge
          open={forgePerson !== null}
          person={forgePerson}
          track={activeTab}
          initialDraft={
            draftOverrides[missionKey(forgePerson)] ?? forgePerson.warm_intro_draft
          }
          onClose={() => setForgePerson(null)}
          onKeep={handleForgeKeep}
        />
      )}

      {/* handoff toast */}
      <AnimatePresence>
        {handoffToast && (
          <motion.div
            key="handoff-toast"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={reduced ? { duration: 0 } : { duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 px-4 py-2 text-sm font-medium backdrop-blur-sm shadow-lg"
            role="status"
          >
            {handoffToast}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/** Skeleton shown while a track is pending progressive-reveal. */
function TrackSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/40 p-5 flex flex-col gap-3 animate-pulse"
          aria-hidden
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
            <div className="h-8 w-12 rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
          <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      ))}
    </>
  );
}
