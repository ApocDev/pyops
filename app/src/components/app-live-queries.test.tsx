// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AppLiveQueries } from "./app-live-queries.tsx";
import {
  bridgeStatusSubscription,
  logisticsContextSubscription,
  researchHorizonSubscription,
  undoStatusSubscription,
} from "../lib/live-query-options.ts";

const fns = vi.hoisted(() => ({
  bridge: vi.fn(),
  horizon: vi.fn(),
  logistics: vi.fn(),
  undo: vi.fn(),
}));

vi.mock("../server/bridge/fns", () => ({ bridgeStatusFn: fns.bridge }));
vi.mock("../server/factorio", () => ({
  logisticsContextFn: fns.logistics,
  researchHorizonFn: fns.horizon,
}));
vi.mock("../server/undo", () => ({ undoStatusFn: fns.undo }));

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(fns)) fn.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppLiveQueries", () => {
  function StatusSubscribers() {
    useQuery(bridgeStatusSubscription);
    useQuery(researchHorizonSubscription);
    useQuery(logisticsContextSubscription);
    useQuery(undoStatusSubscription);
    return null;
  }

  it("owns one interval at each live-status cadence", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AppLiveQueries />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(fns.bridge).toHaveBeenCalledTimes(1);
    expect(fns.horizon).toHaveBeenCalledTimes(1);
    expect(fns.logistics).toHaveBeenCalledTimes(1);
    expect(fns.undo).toHaveBeenCalledTimes(1);

    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));

    expect(fns.bridge).toHaveBeenCalledTimes(3);
    expect(fns.horizon).toHaveBeenCalledTimes(2);
    expect(fns.logistics).toHaveBeenCalledTimes(2);
    expect(fns.undo).toHaveBeenCalledTimes(2);
  });

  it("lets later responsive-layout subscribers reuse the fresh poll result", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AppLiveQueries />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    render(
      <QueryClientProvider client={client}>
        <StatusSubscribers />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(fns.bridge).toHaveBeenCalledTimes(1);
    expect(fns.horizon).toHaveBeenCalledTimes(1);
    expect(fns.logistics).toHaveBeenCalledTimes(1);
    expect(fns.undo).toHaveBeenCalledTimes(1);
  });
});
