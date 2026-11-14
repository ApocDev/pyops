// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ModulesChip, ModulesModal } from "./modules-modal.tsx";

afterEach(cleanup);

// assembling-machine-2 after a re-sync: no effects allowed, so no beacon can
// carry a module it accepts
vi.mock("../server/factorio", () => ({
  modulePickerFn: () =>
    Promise.resolve({
      machine: { name: "assembling-machine-2", display: "Assembling machine 2", moduleSlots: 0 },
      allowProductivity: true,
      modules: [],
      beacons: [
        {
          name: "beacon",
          display: "Beacon",
          distributionEffectivity: 1.5,
          moduleSlots: 2,
          energyUsageW: 480_000,
          profile: null,
          unlocked: true,
          modules: [],
        },
      ],
      beaconModules: [],
    }),
  modulePresetsForFn: () => Promise.resolve([]),
  moduleInfoFn: () => Promise.resolve([]),
  deleteModulePresetFn: vi.fn(),
  saveModulePresetFn: vi.fn(),
  setModulePresetDefaultFn: vi.fn(),
}));
vi.mock("./icons", () => ({ Icon: () => null }));
vi.mock("./hover", () => ({ CursorHover: ({ children }: { children: ReactNode }) => children }));

const saved = [{ beacon: "beacon", modules: ["speed-module-3", "speed-module-3"], count: 1 }];

// A plan saved before a re-sync can hold beacons the machine now ignores. They
// still draw power, so the editor must stay reachable to remove them.
describe("a loadout the machine no longer accepts", () => {
  it("hides the chip only when nothing is configured", () => {
    const props = { modules: [], slots: 0, effectsAllowed: false, onClick: () => {} };
    expect(render(<ModulesChip {...props} beacons={[]} />).container.innerHTML).toBe("");
    const onClick = vi.fn();
    const { getByRole } = render(<ModulesChip {...props} beacons={saved} onClick={onClick} />);
    fireEvent.click(getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });

  it("lets the dialog remove a saved beacon while adding stays disabled", async () => {
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findByTitle, getByRole } = render(
      <QueryClientProvider client={client}>
        <ModulesModal
          recipe="iron-gear-wheel"
          recipeDisplay="Iron gear wheel"
          machineName="assembling-machine-2"
          modules={[]}
          beacons={saved}
          onChange={onChange}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await findByTitle("Remove beacon"));
    expect(onChange).toHaveBeenCalledWith([], []);
    await waitFor(() =>
      expect(getByRole("button", { name: "+ Add" }).getAttribute("aria-disabled")).toBe("true"),
    );
  });
});
