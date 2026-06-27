import { useSyncExternalStore } from "react";

/** Tiny store for whether the data-sync modal is open, so the auto-detect (in the
 * modal itself), the nav indicator, and the Settings sync button can all drive the
 * one modal. Mirrors the chat-store subscribe pattern. */
let open = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((cb) => cb());

// arrow-function props so they can be passed by reference (e.g. to
// useSyncExternalStore) without unbound-`this` concerns
export const driftModal = {
  open: () => {
    if (!open) {
      open = true;
      emit();
    }
  },
  close: () => {
    if (open) {
      open = false;
      emit();
    }
  },
  isOpen: () => open,
  subscribe: (cb: () => void) => {
    subs.add(cb);
    return () => void subs.delete(cb);
  },
};

export const useDriftModalOpen = (): boolean =>
  useSyncExternalStore(driftModal.subscribe, driftModal.isOpen, () => false);
