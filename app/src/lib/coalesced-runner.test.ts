import { describe, expect, it, vi } from "vite-plus/test";
import { createCoalescedRunner } from "./coalesced-runner.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("createCoalescedRunner", () => {
  it("shares the active mutation then flushes the latest pending state once", async () => {
    let pending = false;
    const waits = [deferred(), deferred()];
    const run = vi.fn(async () => {
      pending = false; // this run captured the latest state
      await waits[run.mock.calls.length - 1].promise;
      return true;
    });
    const flush = createCoalescedRunner(run, () => pending);

    const first = flush();
    pending = true; // an edit lands while the first mutation is in flight
    const concurrent = flush();
    expect(concurrent).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);

    waits[0].resolve();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    waits[1].resolve();
    await first;
    expect(pending).toBe(false);
  });

  it("does not hot-loop pending state after a failed run", async () => {
    let pending = true;
    const run = vi.fn(async () => false);
    const flush = createCoalescedRunner(run, () => pending);

    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    pending = false;
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
