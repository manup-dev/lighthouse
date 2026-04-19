import type { LogEvent, MatchResult, StageEvent } from "./types";

export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) ||
  "http://localhost:8000";

export interface StartMatchArgs {
  repo_url: string;
  location?: string;
  user_hint?: string;
}

export interface StartMatchResponse {
  match_id: string;
}

/** POST /match — returns a match_id. Throws on any non-2xx or network error. */
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
  if (!res.ok) {
    throw new Error(`POST /match failed: ${res.status}`);
  }
  return (await res.json()) as StartMatchResponse;
}

export interface SseHandlers {
  onStage?: (e: StageEvent) => void;
  onLog?: (e: LogEvent) => void;
  onResult?: (r: MatchResult) => void;
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
