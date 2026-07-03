// @vitest-environment jsdom
/**
 * gameEval approval card (#15): the proposed Lua renders verbatim with
 * Run/Dismiss controls, nothing executes without the click, the result shows
 * inline, and "Share result" sends it back into the chat.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GameEvalCard } from "./game-eval-card.tsx";

afterEach(cleanup);

const { bridgeEval } = vi.hoisted(() => ({ bridgeEval: vi.fn() }));
vi.mock("#/server/bridge/fns.ts", () => ({ bridgeEvalFn: bridgeEval }));

const proposal = { proposed: true as const, code: "game.tick", note: "read the tick" };

describe("GameEvalCard", () => {
  beforeEach(() => bridgeEval.mockReset());

  it("shows the exact Lua and does not execute until Run is clicked", () => {
    const { getByText } = render(<GameEvalCard proposal={proposal} />);
    expect(getByText("game.tick")).toBeTruthy();
    expect(getByText("read the tick")).toBeTruthy();
    expect(getByText(/runs only if you approve/)).toBeTruthy();
    expect(bridgeEval).not.toHaveBeenCalled();
  });

  it("Run sends the code over the bridge and shows the result", async () => {
    bridgeEval.mockResolvedValue({ ok: true, result: "123456" });
    const { getByText, findByText } = render(<GameEvalCard proposal={proposal} />);
    fireEvent.click(getByText(/Run in game/));
    expect(bridgeEval).toHaveBeenCalledWith({ data: { code: "game.tick" } });
    expect(await findByText("123456")).toBeTruthy();
    expect(getByText("ran")).toBeTruthy();
  });

  it("Dismiss marks the proposal as not run", () => {
    const { getByText } = render(<GameEvalCard proposal={proposal} />);
    fireEvent.click(getByText("Dismiss"));
    expect(getByText(/dismissed — not run/)).toBeTruthy();
    expect(bridgeEval).not.toHaveBeenCalled();
  });

  it("a failed run shows the error and offers a retry", async () => {
    bridgeEval.mockResolvedValue({ ok: false, error: "the in-game mod isn't connected" });
    const { getByText, findByText } = render(<GameEvalCard proposal={proposal} />);
    fireEvent.click(getByText(/Run in game/));
    expect(await findByText(/mod isn't connected/)).toBeTruthy();
    expect(getByText("Retry")).toBeTruthy();
  });

  it("Share result sends the output back into the chat", async () => {
    bridgeEval.mockResolvedValue({ ok: true, result: "42" });
    const onShareResult = vi.fn();
    const { getByText, findByText } = render(
      <GameEvalCard proposal={proposal} onShareResult={onShareResult} />,
    );
    fireEvent.click(getByText(/Run in game/));
    fireEvent.click(await findByText("Share result with assistant"));
    await waitFor(() => expect(onShareResult).toHaveBeenCalled());
    expect(onShareResult.mock.calls[0][0]).toContain("42");
  });
});
