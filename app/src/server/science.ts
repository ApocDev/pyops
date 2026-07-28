import { createServerFn } from "@tanstack/react-start";
import type { ScienceBank } from "../db/schema.ts";
import * as science from "./science-block.server.ts";

/** Labs a plan can choose, from whatever mod set is loaded. */
export const labOptionsFn = createServerFn({ method: "GET" }).handler(async () =>
  science.labOptions(),
);

/** The project's science block with its solved bank, or null if none exists. */
export const scienceBlockFn = createServerFn({ method: "GET" }).handler(async () => {
  const block = science.scienceBlock();
  if (!block) return null;
  return { ...block, result: science.solveScienceBank(block.bank) };
});

/** Create the singleton science block (or return the existing one). */
export const ensureScienceBlockFn = createServerFn({ method: "POST" }).handler(async () =>
  science.ensureScienceBlock(),
);

export const saveScienceBankFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; bank: ScienceBank }) => d)
  .handler(async ({ data }) => {
    science.saveScienceBank(data.id, data.bank);
    return { ok: true as const, result: science.solveScienceBank(data.bank) };
  });

/** Technologies that cost science, for the derive-from-a-technology helper. */
export const techCostsFn = createServerFn({ method: "GET" }).handler(async () =>
  science.techCosts().map((t) => ({ name: t.name, display: t.display, unitCount: t.unitCount })),
);

/** Rates that finish a technology in the given number of minutes. */
export const ratesForTechFn = createServerFn({ method: "POST" })
  .validator((d: { tech: string; minutes: number }) => d)
  .handler(async ({ data }) => science.ratesForTechIn(data.tech, data.minutes));
