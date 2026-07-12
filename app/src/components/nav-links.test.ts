import { describe, expect, it } from "vite-plus/test";

import { NAV_LINKS, navLinkActive } from "./nav-links";

const link = (label: string) => NAV_LINKS.find((item) => item.label === label)!;

describe("workspace navigation", () => {
  it("keeps Factory active across its three views", () => {
    expect(navLinkActive(link("Factory"), "/factory")).toBe(true);
    expect(navLinkActive(link("Factory"), "/factory/connections")).toBe(true);
    expect(navLinkActive(link("Factory"), "/factory/scenario")).toBe(true);
    expect(navLinkActive(link("Factory"), "/explore")).toBe(false);
  });

  it("keeps Explore active across search and dependencies", () => {
    expect(navLinkActive(link("Explore"), "/explore")).toBe(true);
    expect(navLinkActive(link("Explore"), "/explore/dependencies")).toBe(true);
    expect(navLinkActive(link("Explore"), "/factory")).toBe(false);
  });

  it("matches nested block routes without claiming another workspace", () => {
    expect(navLinkActive(link("Blocks"), "/block/42")).toBe(true);
    expect(navLinkActive(link("Factory"), "/block/42")).toBe(false);
  });
});
