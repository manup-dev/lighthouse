"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  applyTheme,
  readStoredTheme,
  resolveEffective,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];

function nextTheme(t: Theme): Theme {
  const i = ORDER.indexOf(t);
  return ORDER[(i + 1) % ORDER.length];
}

function labelFor(t: Theme): string {
  if (t === "light") return "Light theme";
  if (t === "dark") return "Dark theme";
  return "System theme";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = readStoredTheme();
    setTheme(t);
    setMounted(true);

    // Track OS-level changes when user is in "system" mode.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function cycle() {
    const nt = nextTheme(theme);
    setTheme(nt);
    writeStoredTheme(nt);
    applyTheme(nt);
  }

  // Pre-mount: render a neutral placeholder so SSR/first-paint match.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Theme"
        className="h-8 w-8 rounded-lg border border-neutral-200 dark:border-neutral-800"
      />
    );
  }

  const effective = resolveEffective(theme);

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={labelFor(theme)}
      title={labelFor(theme)}
      className={clsx(
        "group inline-flex items-center gap-1.5 rounded-lg h-8 px-2",
        "border border-neutral-200 dark:border-neutral-800",
        "bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm",
        "text-neutral-600 dark:text-neutral-300",
        "hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors",
      )}
    >
      <span className="relative h-4 w-4">
        <SunIcon
          className={clsx(
            "absolute inset-0 transition-all duration-300",
            effective === "light" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90",
          )}
        />
        <MoonIcon
          className={clsx(
            "absolute inset-0 transition-all duration-300",
            effective === "dark" ? "opacity-100 rotate-0" : "opacity-0 rotate-90",
          )}
        />
      </span>
      <span className="text-[10px] uppercase tracking-wider opacity-60 group-hover:opacity-100 hidden sm:inline">
        {theme === "system" ? "auto" : theme}
      </span>
    </button>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
