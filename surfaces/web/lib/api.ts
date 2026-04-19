import type { CrustQueryPlan, LogEvent, MatchResult, StageEvent } from "./types";

// Default to same-origin `/api` so the app works behind a single cloudflared
// tunnel (Next.js rewrites /api/* → FastAPI on loopback). Override with
// NEXT_PUBLIC_API_BASE=http://localhost:8787 for local-dev without proxy.
export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) ||
  "/api";

export interface StartMatchArgs {
  repo_url: string;
  location?: string;
  user_hint?: string;
}

export interface QueueState {
  position: number;
  depth: number;
  eta_sec: number;
}

export interface StartMatchResponse {
  match_id: string;
  queue?: QueueState;
}

/** Raised when the server rejects a /match because the GPU queue is full. */
export class QueueFullError extends Error {
  depth: number;
  maxDepth: number;
  constructor(depth: number, maxDepth: number) {
    super(`queue full: ${depth}/${maxDepth}`);
    this.name = "QueueFullError";
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

/** POST /match — returns a match_id. Throws QueueFullError on 503, Error otherwise. */
export async function startMatch(
  args: StartMatchArgs,
  signal?: AbortSignal,
): Promise<StartMatchResponse> {
  const res = await fetch(`${API_BASE}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (res.status === 503) {
    // FastAPI wraps the detail dict under `{ detail: {...} }`.
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    if (detail?.reason === "queue_full") {
      throw new QueueFullError(
        Number(detail.depth) || 0,
        Number(detail.max_depth) || 0,
      );
    }
  }
  if (!res.ok) {
    throw new Error(`POST /match failed: ${res.status}`);
  }
  return (await res.json()) as StartMatchResponse;
}

export interface GalleryItem {
  slug: string;
  display_name: string;
  tagline: string;
  why: string;
  baked_at: number | null;
  repo_url: string | null;
  counts: { investors: number; design_partners: number; talent: number };
}

/** GET /gallery — list baked sample runs (for queue-wait and empty-state gallery). */
export async function fetchGallery(signal?: AbortSignal): Promise<GalleryItem[]> {
  const res = await fetch(`${API_BASE}/gallery`, { signal });
  if (!res.ok) throw new Error(`GET /gallery failed: ${res.status}`);
  const data = (await res.json()) as { items: GalleryItem[] };
  return data.items ?? [];
}

/** GET /gallery/{slug} — full envelope with the baked MatchResult. */
export async function fetchGalleryItem(
  slug: string,
  signal?: AbortSignal,
): Promise<{
  slug: string;
  display_name: string;
  tagline: string;
  why: string;
  result: MatchResult;
}> {
  const res = await fetch(`${API_BASE}/gallery/${slug}`, { signal });
  if (!res.ok) throw new Error(`GET /gallery/${slug} failed: ${res.status}`);
  return await res.json();
}

export interface RerunPreview {
  name: string;
  subtitle: string;
}

export interface RerunQueryResponse {
  count: number;
  preview: RerunPreview[];
  elapsed_ms: number;
  error: string | null;
}

/** POST /rerun-query — re-executes a single Crustdata query with an edited payload. */
export async function rerunQuery(
  plan: CrustQueryPlan,
  signal?: AbortSignal,
): Promise<RerunQueryResponse> {
  const res = await fetch(`${API_BASE}/rerun-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`POST /rerun-query failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as RerunQueryResponse;
}

export interface SseHandlers {
  onStage?: (e: StageEvent) => void;
  onLog?: (e: LogEvent) => void;
  onResult?: (r: MatchResult) => void;
  onQueue?: (q: QueueState) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

/**
 * Subscribe to the pipeline event stream.
 * Returns a cleanup fn that closes the EventSource.
 */
export function subscribeEvents(
  matchId: string,
  handlers: SseHandlers,
): () => void {
  const url = `${API_BASE}/match/${matchId}/events`;
  const es = new EventSource(url);

  es.addEventListener("stage", (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as StageEvent;
      handlers.onStage?.(data);
    } catch (err) {
      handlers.onError?.(`bad stage payload: ${String(err)}`);
    }
  });

  es.addEventListener("log", (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as LogEvent;
      handlers.onLog?.(data);
    } catch (err) {
      handlers.onError?.(`bad log payload: ${String(err)}`);
    }
  });

  es.addEventListener("queue", (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as QueueState;
      handlers.onQueue?.(data);
    } catch (err) {
      handlers.onError?.(`bad queue payload: ${String(err)}`);
    }
  });

  es.addEventListener("result", (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as MatchResult;
      handlers.onResult?.(data);
    } catch (err) {
      handlers.onError?.(`bad result payload: ${String(err)}`);
    }
  });

  es.addEventListener("error", (evt) => {
    // Browsers send an un-typed error event when the connection drops — treat both.
    const msg = (evt as MessageEvent).data;
    if (typeof msg === "string") {
      try {
        const data = JSON.parse(msg) as { message: string };
        handlers.onError?.(data.message);
        return;
      } catch {
        /* fall through */
      }
    }
    handlers.onError?.("connection dropped");
  });

  return () => {
    es.close();
    handlers.onClose?.();
  };
}
