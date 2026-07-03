/**
 * Toast queue (#90/#83) — the state half of the shared toast primitive. The
 * queue lives in a module-level TanStack Store so `toast()` is callable from
 * anywhere (hotkey handlers, mutation callbacks, plain functions), not just
 * from inside React; the `Toaster` in `components/ui/toast.tsx` renders it.
 *
 * The transitions are pure functions (`pushToast`/`dismissToast`) so the
 * queue behavior — cap, ordering, id assignment — is unit-testable without
 * timers or DOM.
 */
import { Store } from "@tanstack/store";

export type ToastTone = "default" | "success" | "destructive";

export type ToastEntry = {
  id: number;
  message: string;
  tone: ToastTone;
  /** ms until auto-dismiss. */
  duration: number;
  /** Optional action button ("Undo", "Reload", …). Dismisses the toast after running. */
  action?: { label: string; onClick: () => void };
};

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export const TOAST_DURATION_DEFAULT = 4000;
/** At most this many toasts on screen; older ones are dropped first. */
export const TOAST_CAP = 3;

/** Append a toast, dropping the oldest entries beyond the cap. Pure. */
export function pushToast(
  queue: ToastEntry[],
  entry: ToastEntry,
  cap: number = TOAST_CAP,
): ToastEntry[] {
  const next = [...queue, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Remove a toast by id (no-op when it's already gone). Pure. */
export function dismissToast(queue: ToastEntry[], id: number): ToastEntry[] {
  return queue.some((t) => t.id === id) ? queue.filter((t) => t.id !== id) : queue;
}

export const toastStore = new Store<ToastEntry[]>([]);

let nextId = 1;

/** Show a toast (bottom corner, auto-dismissing). Returns its id so callers
 * can dismiss it early via `dismiss(id)`. */
export function toast(input: ToastInput): number {
  const id = nextId++;
  const entry: ToastEntry = {
    id,
    message: input.message,
    tone: input.tone ?? "default",
    duration: input.duration ?? TOAST_DURATION_DEFAULT,
    ...(input.action ? { action: input.action } : {}),
  };
  toastStore.setState((q) => pushToast(q, entry));
  return id;
}

/** Dismiss a toast by id (auto-dismiss and the × button both come here). */
export function dismiss(id: number): void {
  toastStore.setState((q) => dismissToast(q, id));
}
