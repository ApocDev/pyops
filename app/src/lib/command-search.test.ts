import { describe, expect, it } from "vite-plus/test";
import { fuzzyScore, rankMatches } from "./command-search";

describe("fuzzyScore", () => {
  it("matches everything on an empty query", () => {
    expect(fuzzyScore("", "Coherence")).toBeGreaterThan(0);
    expect(fuzzyScore("   ", "Coherence")).toBeGreaterThan(0);
  });

  it("tiers exact > prefix > word-boundary > substring > subsequence", () => {
    const exact = fuzzyScore("browse", "Browse");
    const prefix = fuzzyScore("bro", "Browse");
    const word = fuzzyScore("block", "New block");
    const sub = fuzzyScore("lock", "New block");
    const subseq = fuzzyScore("nbl", "New block");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it("is case-insensitive and rejects non-matches", () => {
    expect(fuzzyScore("COH", "Coherence")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Coherence")).toBe(0);
    // subsequence must be in order
    expect(fuzzyScore("ehoc", "Coherence")).toBe(0);
  });

  it("prefers shorter targets within a tier", () => {
    expect(fuzzyScore("iron", "Iron plate")).toBeGreaterThan(
      fuzzyScore("iron", "Iron gear wheel factory block"),
    );
  });
});

describe("rankMatches", () => {
  const pages = ["Blocks", "Factory", "Coherence", "Browse", "Tasks"];

  it("filters and sorts best-first", () => {
    expect(rankMatches("b", pages, (p) => p)).toEqual(["Blocks", "Browse"]);
    expect(rankMatches("coh", pages, (p) => p)).toEqual(["Coherence"]);
  });

  it("keeps input order on ties (stable)", () => {
    expect(rankMatches("", pages, (p) => p)).toEqual(pages);
  });

  it("returns empty for no matches", () => {
    expect(rankMatches("zzz", pages, (p) => p)).toEqual([]);
  });
});
