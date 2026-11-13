/**
 * Which assistant conversations are generating right now, plus a change signal.
 * `chat-store.ts` writes here as its Chat instances change status; global chrome
 * (the nav run indicator, the dock button) reads here. Keeping this apart from
 * the store means the always-mounted top bar never imports the AI SDK: the Chat
 * runtime loads only when the assistant page or dock opens.
 */

const running = new Set<string>();
const listeners = new Set<() => void>();

/** Tell subscribers something changed (a status flip, or a send the server accepted). */
export function notifyRuns(): void {
  listeners.forEach((l) => l());
}

/** Record whether a conversation is generating, notifying on every call. */
export function setRunning(id: string, generating: boolean): void {
  if (generating) running.add(id);
  else running.delete(id);
  notifyRuns();
}

/** Subscribe to run/persistence changes (for the nav indicator + sidebar refresh). */
export function subscribeRuns(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** How many conversations are generating right now. */
export function activeRunCount(): number {
  return running.size;
}

/** A stable snapshot (sorted, comma-joined ids) of conversations generating right
 * now — safe for useSyncExternalStore (string identity), parse with .split(","). */
export function runningKey(): string {
  return [...running].sort().join(",");
}
