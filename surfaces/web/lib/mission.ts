"use client";

import { useSyncExternalStore } from "react";

export type MissionStatus =
  | "drafted"
  | "refined"
  | "sent"
  | "replied"
  | "meeting"
  | "won"
  | "lost";

export const MISSION_ORDER: MissionStatus[] = [
  "drafted",
  "refined",
  "sent",
  "replied",
  "meeting",
  "won",
];

export interface MissionState {
  status: MissionStatus;
  history: { state: MissionStatus; at: number }[];
  draft_versions: string[]; // most recent last, max 10
  snooze_until?: number;
}

export interface MissionStore {
  version: 1;
  missions: Record<string, MissionState>;
}

const STORAGE_KEY = "lighthouse.mission.v1";
const DRAFT_CAP = 10;

const DEFAULT_STORE: MissionStore = { version: 1, missions: {} };

// ----- Module-level state + subscribers -----

let memoryStore: MissionStore = DEFAULT_STORE;
const subscribers = new Set<() => void>();

function readFromStorage(): MissionStore {
  if (typeof window === "undefined") return DEFAULT_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, missions: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return { version: 1, missions: {} };
    }
    return {
      version: 1,
      missions:
        parsed.missions && typeof parsed.missions === "object"
          ? parsed.missions
          : {},
    };
  } catch {
    return { version: 1, missions: {} };
  }
}

function writeToStorage(next: MissionStore) {
  memoryStore = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota or serialization — swallow, keep in-memory copy
    }
  }
  subscribers.forEach((cb) => cb());
}

// Lazy-initialise memoryStore on first access in the browser so
// useSyncExternalStore returns the persisted snapshot.
let hydrated = false;
function ensureHydrated() {
  if (hydrated) return;
  if (typeof window === "undefined") return;
  memoryStore = readFromStorage();
  hydrated = true;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): MissionStore {
  ensureHydrated();
  return memoryStore;
}

function getServerSnapshot(): MissionStore {
  return DEFAULT_STORE;
}

// ----- Key derivation -----

export function missionKey(person: {
  linkedin: string | null;
  name: string;
  company: string;
}): string {
  if (person.linkedin) {
    return person.linkedin.replace(/\/+$/, "");
  }
  return `fallback:${person.name}|${person.company}`.toLowerCase();
}

// ----- Mutations -----

function emptyState(status: MissionStatus = "drafted"): MissionState {
  return {
    status,
    history: [{ state: status, at: Date.now() }],
    draft_versions: [],
  };
}

function updateMission(
  key: string,
  updater: (prev: MissionState) => MissionState,
) {
  ensureHydrated();
  const prev = memoryStore.missions[key] ?? emptyState();
  const next = updater(prev);
  const nextStore: MissionStore = {
    version: 1,
    missions: { ...memoryStore.missions, [key]: next },
  };
  writeToStorage(nextStore);
}

function orderIndex(status: MissionStatus): number {
  // terminal "lost" is not part of MISSION_ORDER; treat it like a terminal.
  const idx = MISSION_ORDER.indexOf(status);
  return idx === -1 ? MISSION_ORDER.length : idx;
}

// ----- Hook -----

export function useMissionStore() {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const get = (key: string): MissionState | undefined =>
    store.missions[key];

  const setStatus = (key: string, status: MissionStatus) => {
    updateMission(key, (prev) => ({
      ...prev,
      status,
      history: [...prev.history, { state: status, at: Date.now() }],
    }));
  };

  const advance = (key: string, status: MissionStatus) => {
    updateMission(key, (prev) => {
      const prevIdx = orderIndex(prev.status);
      const nextIdx = orderIndex(status);
      // terminal won/lost — no more advance
      if (prev.status === "won" || prev.status === "lost") return prev;
      // already at or past target — no-op
      if (prevIdx >= nextIdx) return prev;
      return {
        ...prev,
        status,
        history: [...prev.history, { state: status, at: Date.now() }],
      };
    });
  };

  const regress = (key: string) => {
    updateMission(key, (prev) => {
      if (
        prev.status === "drafted" ||
        prev.status === "won" ||
        prev.status === "lost"
      ) {
        return prev;
      }
      const idx = MISSION_ORDER.indexOf(prev.status);
      if (idx <= 0) return prev;
      const nextStatus = MISSION_ORDER[idx - 1];
      return {
        ...prev,
        status: nextStatus,
        history: [...prev.history, { state: nextStatus, at: Date.now() }],
      };
    });
  };

  const snooze = (key: string, days: number) => {
    updateMission(key, (prev) => ({
      ...prev,
      snooze_until: Date.now() + days * 86_400_000,
    }));
  };

  const addDraft = (key: string, draft: string) => {
    updateMission(key, (prev) => {
      const next = [...prev.draft_versions, draft];
      const trimmed =
        next.length > DRAFT_CAP ? next.slice(next.length - DRAFT_CAP) : next;
      return { ...prev, draft_versions: trimmed };
    });
  };

  const summary = (): Record<MissionStatus, number> => {
    const counts: Record<MissionStatus, number> = {
      drafted: 0,
      refined: 0,
      sent: 0,
      replied: 0,
      meeting: 0,
      won: 0,
      lost: 0,
    };
    for (const m of Object.values(store.missions)) {
      counts[m.status] = (counts[m.status] ?? 0) + 1;
    }
    return counts;
  };

  const nextDue = (): { key: string; due_at: number } | null => {
    const now = Date.now();
    let best: { key: string; due_at: number } | null = null;
    for (const [key, m] of Object.entries(store.missions)) {
      if (m.snooze_until == null) continue;
      if (m.snooze_until <= now) continue;
      if (best == null || m.snooze_until < best.due_at) {
        best = { key, due_at: m.snooze_until };
      }
    }
    return best;
  };

  return {
    store,
    get,
    advance,
    regress,
    setStatus,
    snooze,
    addDraft,
    summary,
    nextDue,
  };
}
