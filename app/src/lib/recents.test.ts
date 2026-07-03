// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  RECENTS_CAP,
  loadRecents,
  pushRecent,
  recentKey,
  recordRecent,
  type RecentEntry,
} from "./recents";

const block = (id: number): RecentEntry => ({ type: "block", id });
const good = (name: string): RecentEntry => ({
  type: "good",
  name,
  goodKind: "item",
  display: name.toUpperCase(),
});

describe("pushRecent", () => {
  it("prepends new entries, most recent first", () => {
    const list = pushRecent(pushRecent([], block(1)), good("iron-plate"));
    expect(list.map(recentKey)).toEqual(["good:iron-plate", "block:1"]);
  });

  it("moves a revisited entry to the front instead of duplicating", () => {
    let list: RecentEntry[] = [block(1), good("iron-plate"), block(2)];
    list = pushRecent(list, block(2));
    expect(list.map(recentKey)).toEqual(["block:2", "block:1", "good:iron-plate"]);
    expect(list).toHaveLength(3);
  });

  it("a block and a good never collide even with lookalike identities", () => {
    // recentKey namespaces by type, so block ids and good names can't clash
    expect(recentKey(block(7))).not.toBe(recentKey(good("7")));
  });

  it("caps the list, dropping the oldest", () => {
    let list: RecentEntry[] = [];
    for (let i = 1; i <= RECENTS_CAP + 3; i++) list = pushRecent(list, block(i));
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0]).toEqual(block(RECENTS_CAP + 3));
    // the earliest pushes fell off the end
    expect(list.map(recentKey)).not.toContain("block:1");
  });
});

describe("localStorage round-trip", () => {
  beforeEach(() => localStorage.clear());

  it("records and reloads visits in order", () => {
    recordRecent(block(4));
    recordRecent(good("molten-iron"));
    expect(loadRecents().map(recentKey)).toEqual(["good:molten-iron", "block:4"]);
  });

  it("revisiting through recordRecent dedupes in storage too", () => {
    recordRecent(block(4));
    recordRecent(good("molten-iron"));
    recordRecent(block(4));
    expect(loadRecents().map(recentKey)).toEqual(["block:4", "good:molten-iron"]);
  });

  it("survives garbage in the storage slot", () => {
    localStorage.setItem("pyops.palette.recents", "not json {");
    expect(loadRecents()).toEqual([]);
    localStorage.setItem("pyops.palette.recents", JSON.stringify({ nope: true }));
    expect(loadRecents()).toEqual([]);
  });

  it("filters entries that don't match the shape (old app versions)", () => {
    localStorage.setItem(
      "pyops.palette.recents",
      JSON.stringify([
        { type: "block", id: 3 },
        { type: "block", id: "three" }, // wrong id type
        { type: "good", name: "iron-plate" }, // missing goodKind/display
        { type: "good", name: "coal", goodKind: "item", display: "Coal" },
        { type: "page", to: "/browse" }, // unknown type
      ]),
    );
    expect(loadRecents().map(recentKey)).toEqual(["block:3", "good:coal"]);
  });
});
