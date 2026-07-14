// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BridgeIndicator } from "./bridge-indicator.tsx";

// Stub the router Link to a plain anchor (no router context needed) and the
// bridge status server fn so we can drive each connection state.
const { bridgeStatus } = vi.hoisted(() => ({ bridgeStatus: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  // Spread the rest so the Tooltip trigger's props/ref (React 19 passes `ref`
  // as a prop) reach the <a> and the real radix tooltip wires up on focus.
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} data-testid="bridge-link" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../server/bridge/fns", () => ({ bridgeStatusFn: bridgeStatus }));

afterEach(cleanup);
beforeEach(() => bridgeStatus.mockReset());

async function renderIndicator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["bridgeStatus"], await bridgeStatus());
  return render(
    <QueryClientProvider client={client}>
      <BridgeIndicator />
    </QueryClientProvider>,
  );
}

const dot = (el: HTMLElement) => el.querySelector("span.rounded-full")!;

describe("BridgeIndicator", () => {
  it("shows 'game linked' (green) for a fresh peer on a matching protocol", async () => {
    bridgeStatus.mockResolvedValue({
      status: "listening",
      host: "127.0.0.1",
      port: 34197,
      appProtocolVersion: 4,
      lastPeer: { lastSeenMs: Date.now(), protocolVersion: 4, player: "jim" },
    });
    const { findByText, findByRole, getByTestId } = await renderIndicator();
    expect(await findByText("game linked")).toBeTruthy();
    expect(dot(getByTestId("bridge-link")).className).toContain("bg-success");
    fireEvent.focus(getByTestId("bridge-link"));
    expect((await findByRole("tooltip")).textContent).toContain("jim");
  });

  it("flags a protocol mismatch when the peer speaks a different version", async () => {
    bridgeStatus.mockResolvedValue({
      status: "listening",
      host: "127.0.0.1",
      port: 34197,
      appProtocolVersion: 4,
      lastPeer: { lastSeenMs: Date.now(), protocolVersion: 3, player: "jim" },
    });
    const { findByText, getByTestId } = await renderIndicator();
    expect(await findByText("mod mismatch")).toBeTruthy();
    expect(dot(getByTestId("bridge-link")).className).toContain("bg-destructive");
  });

  it("shows 'no game' (amber) while listening with no peer", async () => {
    bridgeStatus.mockResolvedValue({
      status: "listening",
      host: "127.0.0.1",
      port: 34197,
      appProtocolVersion: 4,
      lastPeer: null,
    });
    const { findByText, getByTestId } = await renderIndicator();
    expect(await findByText("no game")).toBeTruthy();
    expect(dot(getByTestId("bridge-link")).className).toContain("bg-warning");
  });

  it("treats a stale peer (older than the freshness window) as disconnected", async () => {
    bridgeStatus.mockResolvedValue({
      status: "listening",
      host: "127.0.0.1",
      port: 34197,
      appProtocolVersion: 4,
      lastPeer: { lastSeenMs: Date.now() - 60_000, protocolVersion: 4, player: "jim" },
    });
    const { findByText } = await renderIndicator();
    expect(await findByText("no game")).toBeTruthy();
  });

  it("surfaces a bind error", async () => {
    bridgeStatus.mockResolvedValue({
      status: "error",
      host: "127.0.0.1",
      port: 34197,
      error: "EADDRINUSE",
      appProtocolVersion: 4,
      lastPeer: null,
    });
    const { findByText, findByRole, getByTestId } = await renderIndicator();
    expect(await findByText("bridge error")).toBeTruthy();
    fireEvent.focus(getByTestId("bridge-link"));
    expect((await findByRole("tooltip")).textContent).toContain("EADDRINUSE");
  });
});
