"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import clsx from "clsx";

export interface InputFormProps {
  onSubmit: (args: {
    repo_url: string;
    location?: string;
    user_hint?: string;
  }) => void;
  disabled?: boolean;
}

const LOCATION_SUGGESTIONS = [
  "Bangalore",
  "Mumbai",
  "Delhi NCR",
  "San Francisco",
  "New York",
  "London",
  "Singapore",
  "Remote / Anywhere",
];

const DEMO_REPO = "https://github.com/manup-dev/lighthouse";
const URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;

/** Return `{org}/{repo}` if the URL parses, else null. */
function parseRepo(raw: string): { org: string; repo: string } | null {
  const trimmed = raw.trim();
  if (!URL_RE.test(trimmed)) return null;
  const parts = trimmed
    .replace(/\/$/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .split("/");
  if (parts.length !== 2) return null;
  return { org: parts[0], repo: parts[1] };
}

export default function InputForm({ onSubmit, disabled }: InputFormProps) {
  const [repo, setRepo] = useState("");
  const [loc, setLoc] = useState("");
  const [hint, setHint] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => parseRepo(repo), [repo]);
  const isValid = parsed !== null;
  const showInvalid = touched && repo.trim().length > 0 && !isValid;

  // `/` hotkey — focus the URL input, as long as focus isn't already in a field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const url = repo.trim();
    if (!url) return;
    setTouched(true);
    if (!isValid) return;
    onSubmit({
      repo_url: url,
      location: loc.trim() || undefined,
      user_hint: hint.trim() || undefined,
    });
  }

  function fillDemo() {
    setRepo(DEMO_REPO);
    setTouched(true);
    // Defer submit so React state flush is visible first.
    window.setTimeout(() => {
      onSubmit({ repo_url: DEMO_REPO });
    }, 60);
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <form
        onSubmit={submit}
        className={clsx(
          "w-full flex flex-col sm:flex-row gap-2 items-stretch",
          "rounded-2xl border transition-colors",
          showInvalid
            ? "border-rose-400 dark:border-rose-500"
            : isValid
            ? "border-emerald-400/80 dark:border-emerald-500/80"
            : "border-neutral-300 dark:border-neutral-700",
          "bg-white/80 dark:bg-neutral-900/60 backdrop-blur-sm shadow-sm p-2",
        )}
      >
        {/* org avatar preview */}
        {parsed && (
          <div className="hidden sm:flex items-center pl-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${parsed.org}.png?size=48`}
              alt=""
              width={32}
              height={32}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          placeholder="paste a GitHub repo URL..."
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          aria-label="GitHub repo URL"
          aria-invalid={showInvalid}
          className={clsx(
            "flex-1 min-w-0 bg-transparent px-3 py-3 text-base outline-none",
            "placeholder:text-neutral-400 text-neutral-900 dark:text-neutral-50",
          )}
        />

        {/* valid checkmark */}
        {isValid && (
          <span
            aria-hidden
            className="hidden sm:flex items-center pr-1 text-emerald-500"
            title="looks good"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4 4 8-8" />
            </svg>
          </span>
        )}

        <div className="hidden sm:block w-px self-stretch bg-neutral-200 dark:bg-neutral-800" />
        <input
          type="text"
          list="lh-location-suggestions"
          placeholder="location (optional)"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          disabled={disabled}
          aria-label="Founder location"
          className={clsx(
            "sm:w-44 bg-transparent px-3 py-3 text-base outline-none",
            "placeholder:text-neutral-400 text-neutral-900 dark:text-neutral-50",
          )}
        />
        <datalist id="lh-location-suggestions">
          {LOCATION_SUGGESTIONS.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={disabled || !repo.trim()}
          className={clsx(
            "rounded-xl px-5 py-3 text-sm font-semibold transition-all",
            "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
            "enabled:hover:-translate-y-[1px] enabled:hover:shadow-md",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {disabled ? "working..." : "Find"}
        </button>
      </form>

      <div className="flex items-center justify-between px-1 text-xs text-neutral-500">
        <div>
          {showInvalid ? (
            <span className="text-rose-500">
              needs a full URL like <code className="font-mono">https://github.com/org/repo</code>
            </span>
          ) : (
            <span>
              Or try{" "}
              <button
                type="button"
                onClick={fillDemo}
                disabled={disabled}
                className="font-mono underline decoration-dotted underline-offset-4 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-50"
              >
                manup-dev/lighthouse
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            disabled={disabled}
            className="text-[11px] underline decoration-dotted underline-offset-4 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-50"
            aria-expanded={showHint}
          >
            {showHint ? "− hide focus" : "+ add custom focus"}
            {hint.trim().length > 0 && !showHint && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
            )}
          </button>
          <div className="hidden sm:block opacity-60">
            press{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 font-mono text-[10px]">
              /
            </kbd>{" "}
            to focus
          </div>
        </div>
      </div>

      {showHint && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 p-3 flex flex-col gap-1">
          <label
            htmlFor="lh-user-hint"
            className="text-[11px] uppercase tracking-[0.2em] text-neutral-500"
          >
            custom focus — steers the thesis + query planner
          </label>
          <textarea
            id="lh-user-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder={
              'e.g. "US investors only, skip India", "focus on fintech buyers not logistics", "ignore the ML wrapper — core is the vector DB"'
            }
            className="w-full bg-transparent resize-y text-sm outline-none text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
          />
          <div className="text-[10px] text-neutral-500">
            appended to the prompts sent to the LLM — overrides what the raw
            repo fingerprint would have inferred.
          </div>
        </div>
      )}
    </div>
  );
}
