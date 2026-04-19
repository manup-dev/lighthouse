"use client";

/**
 * localStorage-backed tracker of previously-seen candidates.
 *
 * Shape of `lighthouse.v1`:
 *   {
 *     seen: { [linkedinUrl: string]: number /* epoch ms of first-seen *\/ },
 *   }
 *
 * Keyed by LinkedIn URL because it's the most stable identifier we have.
 */

const KEY = "lighthouse.v1";

interface StoreShape {
  seen?: Record<string, number>;
}

function read(): StoreShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as StoreShape;
    }
    return {};
  } catch {
    return {};
  }
}

function write(store: StoreShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded / private mode — silently accept */
  }
}

/** Return epoch-ms of first-seen, or null if never seen. */
export function getFirstSeen(linkedin: string | null): number | null {
  if (!linkedin) return null;
  const store = read();
  const ts = store.seen?.[linkedin];
  return typeof ts === "number" ? ts : null;
}

/**
 * Record that `linkedin` was seen right now if it hasn't been before.
 * Idempotent — existing entries are not overwritten.
 */
export function recordSeen(linkedin: string | null): void {
  if (!linkedin) return;
  const store = read();
  const seen = store.seen ?? {};
  if (seen[linkedin]) return;
  seen[linkedin] = Date.now();
  write({ ...store, seen });
}

/** Human-friendly "3 days ago" for a ms timestamp. */
export function relativeFromMs(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours <= 0) return "just now";
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}
