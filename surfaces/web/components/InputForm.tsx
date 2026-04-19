"use client";

import { useState, FormEvent } from "react";
import clsx from "clsx";

export interface InputFormProps {
  onSubmit: (args: { repo_url: string; location?: string }) => void;
  disabled?: boolean;
}

export default function InputForm({ onSubmit, disabled }: InputFormProps) {
  const [repo, setRepo] = useState("");
  const [loc, setLoc] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const url = repo.trim();
    if (!url) return;
    onSubmit({ repo_url: url, location: loc.trim() || undefined });
  }

  return (
    <form
      onSubmit={submit}
      className={clsx(
        "w-full flex flex-col sm:flex-row gap-2 items-stretch",
        "rounded-2xl border border-neutral-300 dark:border-neutral-700",
        "bg-white/80 dark:bg-neutral-900/60 backdrop-blur-sm shadow-sm p-2",
      )}
    >
      <input
        type="text"
        inputMode="url"
        placeholder="paste a GitHub repo URL..."
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        disabled={disabled}
        aria-label="GitHub repo URL"
        className={clsx(
          "flex-1 min-w-0 bg-transparent px-3 py-3 text-base outline-none",
          "placeholder:text-neutral-400 text-neutral-900 dark:text-neutral-50",
        )}
      />
      <div className="hidden sm:block w-px self-stretch bg-neutral-200 dark:bg-neutral-800" />
      <input
        type="text"
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
  );
}
