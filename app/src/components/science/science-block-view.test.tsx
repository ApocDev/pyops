// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ScienceBlockView } from "./science-block-view.tsx";

const fns = vi.hoisted(() => ({ scienceBlock: vi.fn(), labOptions: vi.fn() }));

vi.mock("../../server/science", () => ({
  scienceBlockFn: fns.scienceBlock,
  labOptionsFn: fns.labOptions,
  saveScienceBankFn: vi.fn(),
}));
// live-query-options imports these; the test writes the horizon into the cache
vi.mock("../../server/factorio", () => ({ researchHorizonFn: vi.fn() }));
vi.mock("../../server/bridge/fns", () => ({ bridgeStatusFn: vi.fn() }));
vi.mock("../../server/undo", () => ({ undoStatusFn: vi.fn() }));
vi.mock("../../lib/icons", () => ({ Icon: () => null }));
vi.mock("../../lib/modules-modal", () => ({ ModulesChip: () => null, ModulesModal: () => null }));
vi.mock("./derive-from-tech-dialog", () => ({ DeriveFromTechDialog: () => null }));

const result = (labSpeedBonus: number) => ({
  labs: 60 / (1 + labSpeedBonus),
  totalPerSec: 1,
  productivityMult: 1,
  speedMult: 1,
  labSpeedBonus,
  labProductivityBonus: 0,
  packDemand: { "automation-science-pack": 1 },
  beaconBuildings: [],
  beaconInterference: [],
  upkeep: {},
  totalPowerW: 0,
  unsupported: [],
});

const horizon = (speed: number) => ({ labBonuses: { speed, productivity: 0 } });

beforeEach(() => {
  fns.labOptions.mockReset().mockResolvedValue([]);
  fns.scienceBlock.mockReset();
});

afterEach(cleanup);

describe("ScienceBlockView", () => {
  it("re-solves the open bank when the synced lab bonuses change", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["researchHorizon"], horizon(0));
    const bank = { lab: "lab", packs: { "automation-science-pack": 1 }, labSecondsPerPack: 60 };
    fns.scienceBlock
      .mockResolvedValueOnce({ id: 1, bank, result: result(0) })
      .mockResolvedValueOnce({ id: 1, bank, result: result(2) });

    render(
      <QueryClientProvider client={client}>
        <ScienceBlockView blockId={1} />
      </QueryClientProvider>,
    );
    const speed = () => screen.getByTestId("science-stat-research-speed").textContent;
    await waitFor(() => expect(speed()).toContain("+0%"));
    expect(fns.scienceBlock).toHaveBeenCalledTimes(1);

    // the app-shell poll brings a new bonus while the page stays mounted
    await act(async () => {
      client.setQueryData(["researchHorizon"], horizon(2));
    });
    await waitFor(() => expect(speed()).toContain("+200%"));
    expect(fns.scienceBlock).toHaveBeenCalledTimes(2);

    // an identical poll result does not refetch
    await act(async () => {
      client.setQueryData(["researchHorizon"], horizon(2));
    });
    expect(fns.scienceBlock).toHaveBeenCalledTimes(2);
  });
});
