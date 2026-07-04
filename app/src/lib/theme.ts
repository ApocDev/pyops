/**
 * Theme preference (#107): light / dark / system, a per-browser display choice
 * stored in localStorage — `useSyncExternalStore`-shaped like the number-format
 * store. `applyTheme` sets the `.dark` class and `color-scheme` on <html> so
 * every token (and native controls/scrollbars) follow; it also tracks the OS
 * preference while on "system". The token values themselves live in styles.css
 * (`:root` = light, `.dark` = dark).
 */

export type ThemePref = "light" | "dark" | "system";

const KEY = "pyops.theme";
const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

let pref: ThemePref = (() => {
  if (typeof localStorage === "undefined") return "dark";
  const v = localStorage.getItem(KEY);
  return isPref(v) ? v : "dark"; // dark is the historical default
})();

const listeners = new Set<() => void>();

const mql = () =>
  typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: dark)");

/** The concrete mode a preference resolves to right now. */
export function resolvedTheme(p: ThemePref = pref): "light" | "dark" {
  if (p !== "system") return p;
  return mql()?.matches ? "dark" : "light";
}

/** Paint the resolved theme onto <html>. Safe to call before React mounts. */
export function applyTheme(p: ThemePref = pref) {
  if (typeof document === "undefined") return;
  const mode = resolvedTheme(p);
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode; // native controls + scrollbars
}

export const getTheme = () => pref;

export function setTheme(p: ThemePref) {
  pref = p;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, p);
  applyTheme(p);
  for (const l of listeners) l();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  // while on "system", OS changes must re-resolve — mirror them to subscribers
  const m = mql();
  const onOs = () => {
    if (pref === "system") {
      applyTheme();
      fn();
    }
  };
  m?.addEventListener?.("change", onOs);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    m?.removeEventListener?.("change", onOs);
  };
}
