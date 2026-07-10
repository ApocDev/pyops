/** Serialize an async mutation and coalesce work that arrives while it runs.
 *
 * Every concurrent `flush` shares the active promise. After a successful run,
 * `pending` is checked once and the latest state is flushed before the promise
 * resolves. A failed run stops the loop so callers do not hot-retry unchanged
 * input; the next explicit flush may try again.
 */
export function createCoalescedRunner(run: () => Promise<boolean>, pending: () => boolean) {
  let active: Promise<void> | null = null;

  return function flush(): Promise<void> {
    if (active) return active;
    const work = (async () => {
      do {
        if (!(await run())) return;
      } while (pending());
    })();
    active = work.finally(() => {
      active = null;
    });
    return active;
  };
}
