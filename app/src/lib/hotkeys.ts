import { useEffect, useRef } from "react";

/**
 * Global hotkey layer (#78). Components register combos through `useHotkey`
 * (or `registerHotkey` outside React); a single window keydown listener
 * dispatches to the most recently registered matching handler.
 *
 * - Combos are strings like `"mod+k"`, `"/"`, `"ctrl+shift+z"`, `"escape"`.
 *   `mod` is Cmd on macOS and Ctrl everywhere else, so one registration works
 *   cross-platform.
 * - Keys match by produced value (`KeyboardEvent.key`), so `/` fires on
 *   layouts where it's a shifted key.
 * - While focus is in an input/textarea/contenteditable, registrations are
 *   ignored unless they opt in with `allowInInputs: true` (explicitly-global
 *   combos like Ctrl+K do; single-letter shortcuts must not).
 * - Registration lifetime is the component's: `useHotkey` unregisters on
 *   unmount, so a page-scoped shortcut simply lives in that page's component
 *   while an app-global one lives in a root-mounted component.
 * - When several live registrations match one event, the most recently
 *   registered wins (innermost mounted component overrides), and exactly one
 *   handler runs.
 * - Every registration carries a `description` so a future "?" help sheet can
 *   list active shortcuts via `activeHotkeys()`.
 */

export type ParsedCombo = {
  /** Lowercased `KeyboardEvent.key` value ("k", "/", "escape", "arrowup"). */
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
};

/** Parse `"mod+k"` / `"ctrl+shift+z"` / `"/"` into a matchable shape.
 * Throws on empty or modifier-only combos so typos fail loudly in dev. */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const parsed: ParsedCombo = {
    key: "",
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };
  for (const part of parts) {
    if (part === "ctrl" || part === "control") parsed.ctrl = true;
    else if (part === "meta" || part === "cmd" || part === "command") parsed.meta = true;
    else if (part === "alt" || part === "option") parsed.alt = true;
    else if (part === "shift") parsed.shift = true;
    else if (part === "mod") parsed.mod = true;
    else if (parsed.key) throw new Error(`hotkey combo "${combo}" has more than one key`);
    else parsed.key = part;
  }
  if (!parsed.key) throw new Error(`hotkey combo "${combo}" has no key`);
  return parsed;
}

/** The subset of KeyboardEvent the matcher reads — keeps tests dependency-free. */
export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Does this key event match the parsed combo? `isMac` resolves `mod`.
 *
 * Shift is deliberately ignored for bare printable keys (no modifiers declared):
 * on some layouts `/` is Shift+7, and the produced-key match is what matters.
 * Once any modifier is declared, all four must match exactly, so `ctrl+k` does
 * not also fire on `ctrl+shift+k`. */
export function matchesCombo(e: KeyLike, parsed: ParsedCombo, isMac: boolean): boolean {
  if (e.key.toLowerCase() !== parsed.key) return false;
  const wantCtrl = parsed.ctrl || (parsed.mod && !isMac);
  const wantMeta = parsed.meta || (parsed.mod && isMac);
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== parsed.alt) return false;
  const bareKey = !wantCtrl && !wantMeta && !parsed.alt && !parsed.shift;
  return bareKey || e.shiftKey === parsed.shift;
}

/** True when the event target is a place the user types: inputs, textareas,
 * selects, and contenteditable regions. Non-global hotkeys are suppressed there. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // Walk the contenteditable attribute ourselves: `isContentEditable` isn't
  // implemented in jsdom, and the attribute inherits from ancestors anyway.
  const editable = target.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

export type HotkeyOptions = {
  /** Human-readable purpose, e.g. "Open the command palette". Required so a
   * future shortcut help sheet can enumerate everything registered. */
  description: string;
  /** Fire even while focus is in an input/textarea/contenteditable. Only for
   * explicitly-global chords (Ctrl+K); never bare printable keys. Default false. */
  allowInInputs?: boolean;
  /** Registration participates in dispatch only while true. Default true. */
  enabled?: boolean;
  /** Call `preventDefault()` on match. Default true (Ctrl+K would otherwise
   * focus the browser's address bar, `/` would quick-find in Firefox). */
  preventDefault?: boolean;
};

export type HotkeyRegistration = HotkeyOptions & {
  combo: string;
  handler: (e: KeyboardEvent) => void;
};

type LiveRegistration = HotkeyRegistration & { parsed: ParsedCombo };

const registry: LiveRegistration[] = [];

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/** Route one keydown through the registry. Exported for tests; the window
 * listener is just this bound to the real environment. */
export function dispatchKeydown(e: KeyboardEvent, isMac: boolean = detectMac()): void {
  const inEditable = isEditableTarget(e.target);
  for (let i = registry.length - 1; i >= 0; i--) {
    const reg = registry[i];
    if (reg.enabled === false) continue;
    if (inEditable && !reg.allowInInputs) continue;
    if (!matchesCombo(e, reg.parsed, isMac)) continue;
    if (reg.preventDefault !== false) e.preventDefault();
    reg.handler(e);
    return; // exactly one handler per event — last registered wins
  }
}

const windowListener = (e: KeyboardEvent) => dispatchKeydown(e);

/** Register a hotkey; returns the unregister function. The single window
 * listener is installed with the first registration and removed with the last
 * (SSR-safe: no window access until something registers in the browser). */
export function registerHotkey(reg: HotkeyRegistration): () => void {
  const live: LiveRegistration = { ...reg, parsed: parseCombo(reg.combo) };
  if (registry.length === 0 && typeof window !== "undefined") {
    window.addEventListener("keydown", windowListener);
  }
  registry.push(live);
  return () => {
    const i = registry.indexOf(live);
    if (i >= 0) registry.splice(i, 1);
    if (registry.length === 0 && typeof window !== "undefined") {
      window.removeEventListener("keydown", windowListener);
    }
  };
}

/** Currently registered shortcuts, for a future help overlay. */
export function activeHotkeys(): { combo: string; description: string }[] {
  return registry.map((r) => ({ combo: r.combo, description: r.description }));
}

/** React binding: registers on mount, unregisters on unmount, and always calls
 * the latest handler (no stale closures — the handler rides in a ref, so the
 * registration itself only churns when combo/options change). */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { description, allowInInputs, enabled, preventDefault } = options;
  useEffect(() => {
    if (enabled === false) return;
    return registerHotkey({
      combo,
      description,
      allowInInputs,
      preventDefault,
      handler: (e) => handlerRef.current(e),
    });
  }, [combo, description, allowInInputs, enabled, preventDefault]);
}
