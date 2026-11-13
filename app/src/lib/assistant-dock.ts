import { useSyncExternalStore } from "react";

/** Opens the assistant dock from any page. Ctrl+. (⌘. on macOS): unbound in
 * Chrome and Firefox, and `.` is an unshifted key on common layouts. */
export const ASK_HOTKEY = "mod+.";

/**
 * Open/closed state and the conversation shown by the assistant dock (the
 * right-hand chat panel available on every page). Module state, so the top-bar
 * button, the hotkey and the dock itself share it without a provider.
 */
type DockState = { open: boolean; chatId: string };

const CLOSED: DockState = { open: false, chatId: "" };
let state: DockState = CLOSED;
const listeners = new Set<() => void>();

function set(next: DockState) {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useDock(): DockState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CLOSED,
  );
}

/** Open the dock on its current chat, or a fresh one the first time. */
export function openDock(): void {
  set({ open: true, chatId: state.chatId || crypto.randomUUID() });
}

export function closeDock(): void {
  set({ ...state, open: false });
}

export function toggleDock(): void {
  if (state.open) closeDock();
  else openDock();
}

/** Show a saved conversation in the dock. */
export function showDockChat(chatId: string): void {
  set({ open: true, chatId });
}

export function newDockChat(): void {
  showDockChat(crypto.randomUUID());
}
