"use client";

import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import { startTour } from "./Tour";

export default function TopNav() {
  return (
    <header
      className="
        sticky top-0 z-30 w-full
        border-b border-neutral-200/60 dark:border-neutral-800/60
        bg-[color:var(--background)]/70 backdrop-blur-md
        supports-[backdrop-filter]:bg-[color:var(--background)]/55
      "
    >
      <nav className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-neutral-900 dark:text-neutral-100 hover:opacity-90"
          aria-label="Lighthouse home"
        >
          <Logo size={26} />
          <span className="font-semibold tracking-tight text-[15px]">
            Lighthouse
          </span>
          <span className="hidden md:inline-flex items-center gap-1.5 ml-2 pl-2 border-l border-neutral-200 dark:border-neutral-800 text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            contextcon · bengaluru
          </span>
        </a>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startTour}
            aria-label="Replay onboarding tour"
            title="Replay tour"
            className="
              inline-flex items-center justify-center h-8 w-8 rounded-lg
              border border-neutral-200 dark:border-neutral-800
              bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm
              text-[13px] font-semibold text-neutral-600 dark:text-neutral-300
              hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors
            "
          >
            ?
          </button>
          <a
            href="https://github.com/manup-dev/lighthouse"
            target="_blank"
            rel="noopener noreferrer"
            className="
              hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg
              border border-neutral-200 dark:border-neutral-800
              bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm
              text-[12px] text-neutral-600 dark:text-neutral-300
              hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors
            "
          >
            <GitHubMark />
            <span>GitHub</span>
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}

function GitHubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.98 5.24.98 11.52c0 4.86 3.16 8.99 7.54 10.45.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.87-3.07.67-3.72-1.48-3.72-1.48-.5-1.28-1.23-1.62-1.23-1.62-1-.69.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.69 2.58 1.2 3.21.92.1-.72.39-1.2.7-1.48-2.45-.28-5.03-1.23-5.03-5.48 0-1.21.43-2.2 1.13-2.97-.11-.28-.49-1.4.11-2.91 0 0 .93-.3 3.05 1.13a10.5 10.5 0 0 1 5.55 0c2.12-1.43 3.05-1.13 3.05-1.13.6 1.51.22 2.63.11 2.91.7.77 1.13 1.76 1.13 2.97 0 4.26-2.59 5.19-5.05 5.47.4.35.76 1.03.76 2.09 0 1.51-.01 2.73-.01 3.1 0 .3.2.64.76.53A10.53 10.53 0 0 0 23 11.52C23 5.24 18.26.5 12 .5z" />
    </svg>
  );
}
