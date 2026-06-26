import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleModResult, requestFromMod } from "./inspect.ts";
import type { BridgeRequest } from "./protocol.ts";

// inspect.ts talks to the mod over the real dgram socket; mock that boundary so we
// drive the request/reply correlation (and its failure modes) deterministically.
vi.mock("./server.ts", () => ({ ensureBridge: vi.fn(), sendToPeer: vi.fn() }));
const server = await import("./server.ts");
const sendToPeer = vi.mocked(server.sendToPeer);

const result = (over: Partial<BridgeRequest>): BridgeRequest => ({
  protocol_version: 4,
  type: "bridge.result",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("requestFromMod", () => {
  it("rejects when no mod is connected (sendToPeer fails)", async () => {
    sendToPeer.mockReturnValue(false);
    await expect(requestFromMod("cmd.locate", { name: "iron" })).rejects.toThrow(/isn't connected/);
  });

  it("sends a cmd.* with a fresh request_id and resolves on the matching reply", async () => {
    sendToPeer.mockReturnValue(true);
    const promise = requestFromMod("cmd.locate", { name: "iron-plate", kind: "item" });

    const sent = sendToPeer.mock.calls[0][0];
    expect(sent.type).toBe("cmd.locate");
    expect(sent.payload).toEqual({ name: "iron-plate", kind: "item" });
    expect(typeof sent.request_id).toBe("string");

    // the fake mod replies with the same id
    handleModResult(result({ request_id: sent.request_id, payload: { producers: 3 } }));
    await expect(promise).resolves.toEqual({ producers: 3 });
  });

  it("rejects when the mod doesn't reply within the timeout", async () => {
    vi.useFakeTimers();
    try {
      sendToPeer.mockReturnValue(true);
      const promise = requestFromMod("cmd.locate", {}, 1000);
      const assertion = expect(promise).rejects.toThrow(/didn't reply in time/);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a late reply after timeout is ignored (no unhandled resolution)", async () => {
    vi.useFakeTimers();
    try {
      sendToPeer.mockReturnValue(true);
      const promise = requestFromMod("cmd.locate", {}, 1000);
      const id = sendToPeer.mock.calls[0][0].request_id;
      const assertion = expect(promise).rejects.toThrow(/didn't reply/);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      // the id is gone; a tardy reply is a harmless no-op
      expect(() => handleModResult(result({ request_id: id, payload: {} }))).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleModResult", () => {
  it("ignores a reply with an unknown request_id", () => {
    expect(() => handleModResult(result({ request_id: "never-sent", payload: {} }))).not.toThrow();
  });

  it("ignores a reply with no request_id", () => {
    expect(() => handleModResult(result({ payload: {} }))).not.toThrow();
  });
});
