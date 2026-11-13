// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SyncStatus } from "./sync-status.tsx";

vi.mock("../server/bridge/fns", () => ({ bridgeStatusFn: vi.fn() }));
afterEach(cleanup);

const syncedAt = new Date(Date.now() - 107 * 86_400_000).toISOString();

function renderWithPeer(lastSeenMs: number | null) {
  const client = new QueryClient();
  client.setQueryData(["bridgeStatus"], {
    status: "listening",
    lastPeer: lastSeenMs == null ? null : { lastSeenMs },
  });
  return render(
    <QueryClientProvider client={client}>
      <SyncStatus syncedAt={syncedAt}> · 36 goods</SyncStatus>
    </QueryClientProvider>,
  );
}

describe("SyncStatus", () => {
  it("says Live while the game is linked", () => {
    const { container } = renderWithPeer(Date.now());
    expect(container.textContent).toBe(" Live · 36 goods");
  });

  it("shows the snapshot's age when no game is linked", () => {
    const { container } = renderWithPeer(null);
    expect(container.textContent).toBe(" Last synced 107 days ago · 36 goods");
  });

  it("treats a peer outside the freshness window as unlinked", () => {
    const { container } = renderWithPeer(Date.now() - 60_000);
    expect(container.textContent).toContain("Last synced");
  });
});
