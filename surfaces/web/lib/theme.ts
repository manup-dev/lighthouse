export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "lh-theme";

export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function writeStoredTheme(t: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, t);
}

export function resolveEffective(t: Theme): "light" | "dark" {
  if (t === "light" || t === "dark") return t;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const effective = resolveEffective(t);
  document.documentElement.classList.toggle("dark", effective === "dark");
}

/**
 * Inline script string that runs pre-hydration to set the theme class before
 * paint — no flash of wrong theme on first load.
 */
export const themeBootstrapScript = `
(function(){try{
  var s=localStorage.getItem('${STORAGE_KEY}');
  var t=(s==='light'||s==='dark'||s==='system')?s:'system';
  var e=(t==='system')
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
    : t;
  document.documentElement.classList.toggle('dark', e==='dark');
}catch(_){}
})();
`.trim();
