import { useEffect, useSyncExternalStore } from "react";

import type { IconKind } from "#/lib/icons";

/** The thing a page is focused on, offered to the assistant dock as context. */
export type PageEntity = {
  kind: "block" | "good" | "turd" | "task";
  /** The key the assistant's tools take: a block or task id, a good's or TURD
   * master tech's internal name. */
  id: string;
  /** Localized name shown on the chip. */
  label: string;
  icon?: { kind: IconKind; name: string };
};

/** Where a dock message was asked from. It rides on the user message as a
 * `data-page-context` part: stored with the transcript, rendered as the small
 * "asked from" tag, skipped by model-message conversion, and turned into a
 * system note by the chat route (`server/page-context-note.ts`). */
export type PageContextRecord = {
  path: string;
  /** Top-level page name ("Blocks", "Explore", …). */
  page: string;
  entity?: PageEntity;
};

export const PAGE_CONTEXT_PART = "data-page-context";

/** How the dock names each entity kind ("Ask about this block…"). */
export const ENTITY_NOUN: Record<PageEntity["kind"], string> = {
  block: "block",
  good: "item",
  turd: "TURD",
  task: "task",
};

let focused: PageEntity | null = null;
// `kind:id` of the entity whose chip the user removed. Keyed on identity, so a
// rename or icon change keeps it hidden; focusing a different entity resets it.
let dismissed: string | null = null;
// what the dock shows: the focused entity unless dismissed (stable identity
// between changes, as useSyncExternalStore needs)
let snapshot: PageEntity | null = null;
const listeners = new Set<() => void>();

const keyOf = (entity: PageEntity) => `${entity.kind}:${entity.id}`;

function setFocused(entity: PageEntity | null) {
  if (entity && keyOf(entity) !== dismissed) dismissed = null;
  focused = entity;
  snapshot = focused && keyOf(focused) !== dismissed ? focused : null;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** Pages call this with their focused entity (or null). It is cleared on unmount,
 * so routes that never call it offer no context. */
export function usePageEntity(entity: PageEntity | null): void {
  const { kind, id, label } = entity ?? {};
  const iconKind = entity?.icon?.kind;
  const iconName = entity?.icon?.name;
  useEffect(() => {
    setFocused(
      kind && id && label
        ? {
            kind,
            id,
            label,
            ...(iconKind && iconName ? { icon: { kind: iconKind, name: iconName } } : {}),
          }
        : null,
    );
    return () => setFocused(null);
  }, [kind, id, label, iconKind, iconName]);
}

/** The current page's entity, unless the user removed its chip. */
export function useFocusedEntity(): PageEntity | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}

/** Remove the current entity's chip from the composer. */
export function dismissFocusedEntity(): void {
  if (!focused) return;
  dismissed = keyOf(focused);
  snapshot = null;
  listeners.forEach((l) => l());
}
