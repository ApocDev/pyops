import { describe, expect, it } from "vite-plus/test";
import { interferingBeacons } from "./beacon-interference.ts";

// Groups as the dump helper exports them for Py's AM/FM beacons.
const future: Record<string, string[]> = {
  "beacon-AM2-FM2": ["AM2", "FM2"],
  "beacon-AM2-FM3": ["AM2", "FM3"],
  "beacon-AM3-FM3": ["AM3", "FM3"],
  "diet-beacon-AM3-FM3": ["AM3", "FM3"],
};
const legacy: Record<string, string[]> = {
  "beacon-AM2-FM2": ["AM2-FM2"],
  "beacon-AM2-FM3": ["AM2-FM3"],
  "diet-beacon-AM2-FM2": ["AM2-FM2"],
};
const set = (...names: string[]) => names.map((beacon) => ({ beacon, count: 1 }));

describe("interferingBeacons", () => {
  it("matches the in-game rig with future-beacons on", () => {
    const groups = (n: string) => future[n];
    // AM2-FM2 + AM3-FM3: working in game
    expect(interferingBeacons(set("beacon-AM2-FM2", "beacon-AM3-FM3"), groups)).toEqual([]);
    // AM2-FM2 + AM2-FM3: disabled in game (shared AM level)
    expect(interferingBeacons(set("beacon-AM2-FM2", "beacon-AM2-FM3"), groups)).toEqual([
      "beacon-AM2-FM2",
      "beacon-AM2-FM3",
    ]);
    // a diet beacon shares levels with the full-size family
    expect(interferingBeacons(set("beacon-AM3-FM3", "diet-beacon-AM3-FM3"), groups)).toHaveLength(
      2,
    );
  });

  it("only conflicts on the same AM/FM pair with future-beacons off", () => {
    const groups = (n: string) => legacy[n];
    expect(interferingBeacons(set("beacon-AM2-FM2", "beacon-AM2-FM3"), groups)).toEqual([]);
    expect(interferingBeacons(set("beacon-AM2-FM2", "diet-beacon-AM2-FM2"), groups)).toHaveLength(
      2,
    );
  });

  it("treats more than one copy of a Py beacon as a conflict", () => {
    const groups = (n: string) => future[n];
    expect(interferingBeacons([{ beacon: "beacon-AM2-FM2", count: 2 }], groups)).toEqual([
      "beacon-AM2-FM2",
    ]);
  });

  it("ignores beacons without groups, at any count", () => {
    const groups = (n: string) => future[n] ?? null;
    expect(
      interferingBeacons(
        [
          { beacon: "vat-brain", count: 3 },
          { beacon: "beacon-AM2-FM2", count: 1 },
        ],
        groups,
      ),
    ).toEqual([]);
  });
});
