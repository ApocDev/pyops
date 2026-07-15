// @vitest-environment jsdom
/**
 * Show-in-game on assistant cards (#14): the button pushes a created block to
 * the in-game build sheet over the bridge and reports sent / not-connected.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ShowInGameButton } from "./show-in-game-button.tsx";

afterEach(cleanup);

const { showBlock } = vi.hoisted(() => ({ showBlock: vi.fn() }));
vi.mock("#/server/factorio", () => ({ bridgeShowBlockFn: showBlock }));

describe("ShowInGameButton", () => {
  beforeEach(() => showBlock.mockReset());

  it("sends the block id over the bridge and confirms", async () => {
    showBlock.mockResolvedValue({ sent: true, name: "Iron plates" });
    const { getByText, findByText } = render(<ShowInGameButton blockId={7} />);
    fireEvent.click(getByText("Show in game"));
    expect(showBlock).toHaveBeenCalledWith({ data: 7 });
    expect(await findByText(/Opened in game/)).toBeTruthy();
  });

  it("reports a disconnected game instead of pretending it opened", async () => {
    showBlock.mockResolvedValue({ sent: false, name: null });
    const { getByText, findByText } = render(<ShowInGameButton blockId={7} />);
    fireEvent.click(getByText("Show in game"));
    expect(await findByText(/Game not connected/)).toBeTruthy();
  });

  it("does nothing until clicked and supports a custom label", () => {
    const { getByText } = render(<ShowInGameButton blockId={3} label="#3 in game" />);
    expect(getByText("#3 in game")).toBeTruthy();
    expect(showBlock).not.toHaveBeenCalled();
  });
});
