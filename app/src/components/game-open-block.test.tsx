// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { GameOpenBlock } from "./game-open-block.tsx";
import { bridgeStatusQuery } from "../lib/live-query-options.ts";
import type { GameOpenRequest } from "../server/bridge/open-request.ts";

const navigate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock("../lib/toast-store", () => ({ toast }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../server/bridge/fns", () => ({ bridgeStatusFn: vi.fn() }));

const MOUNT = 1_000_000;

// Mount on a cold page (no cached bridge status), then let the poll deliver.
function mountCold() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <GameOpenBlock />
    </QueryClientProvider>,
  );
  // react-query batches observer updates on a timer, so flush it inside act
  const deliver = (openRequest: GameOpenRequest | null) =>
    act(async () => {
      client.setQueryData(bridgeStatusQuery.queryKey, { openRequest } as never);
      await vi.advanceTimersByTimeAsync(0);
    });
  return deliver;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MOUNT);
  navigate.mockReset();
  toast.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GameOpenBlock", () => {
  it("opens a request that arrives after mount, even in the first status read", async () => {
    const deliver = mountCold();
    await deliver({ to: "block", id: 60, at: MOUNT + 500 });
    expect(navigate).toHaveBeenCalledWith({ to: "/block/$id", params: { id: "60" } });
  });

  it("ignores a request from before the page loaded, then follows newer ones once", async () => {
    const deliver = mountCold();
    await deliver({ to: "block", id: 3, at: MOUNT - 10_000 });
    expect(navigate).not.toHaveBeenCalled();

    await deliver({ to: "block", id: 7, at: MOUNT + 2_000 });
    await deliver({ to: "block", id: 7, at: MOUNT + 2_000 }); // the same request on the next poll
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/block/$id", params: { id: "7" } });
  });

  it("opens the factory resource view when several blocks run the recipe", async () => {
    const deliver = mountCold();
    const good = { name: "plate", kind: "item" } as const;
    await deliver({ to: "good", recipe: "smelt", good, at: MOUNT + 500 });
    expect(navigate).toHaveBeenCalledWith({
      to: "/factory",
      search: { good: "plate", kind: "item", recipe: "smelt" },
    });
  });

  it("nudges with a toast whose action opens the good's resource view", async () => {
    const deliver = mountCold();
    const good = { name: "plate", kind: "item" } as const;
    await deliver({ to: "none", label: "Smelt ore", good, at: MOUNT + 500 });
    expect(navigate).not.toHaveBeenCalled();
    const [input] = toast.mock.calls[0];
    expect(input.message).toBe("No block plans Smelt ore yet");
    input.action.onClick();
    expect(navigate).toHaveBeenCalledWith({
      to: "/factory",
      search: { good: "plate", kind: "item" },
    });
  });
});
