import { describe, expect, it } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mechanical enforcement of docs/development/design.md (issue #103): raw palette classes,
 * stray corner rounding, hex colors, and off-scale text sizes fail the suite
 * with a file:line list. If a violation is ever intentional, add it to the
 * matching EXCEPTIONS list with a comment saying why.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const SELF = "design-system.test.ts";

/** "path-suffix:substring" entries that are allowed to keep matching. */
const EXCEPTIONS: string[] = [];

const files = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => !f.endsWith(SELF) && !f.endsWith("routeTree.gen.ts"));

function violations(pattern: RegExp, opts?: { tsxOnly?: boolean; inStrings?: boolean }): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (opts?.tsxOnly && !f.endsWith(".tsx")) continue;
    const lines = readFileSync(join(SRC, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      // class names only live in string literals — prose in comments/JSX text
      // legitimately contains words like "rounded".
      const haystack = opts?.inStrings
        ? [...line.matchAll(/["'`]([^"'`]*)["'`]/g)].map((s) => s[1]).join(" ")
        : line;
      const m = haystack.match(pattern);
      if (!m) return;
      const hit = `${f}:${i + 1}:${m[0]}`;
      if (EXCEPTIONS.some((e) => hit.includes(e))) return;
      out.push(hit);
    });
  }
  return out;
}

describe("design system (docs/development/design.md)", () => {
  it("uses semantic tokens, not raw Tailwind palette classes", () => {
    expect(
      violations(
        /\b(?:text|bg|border|ring|fill|stroke|outline|accent|from|via|to|divide|shadow|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/,
        { inStrings: true },
      ),
    ).toEqual([]);
  });

  it("keeps corners square — no rounded classes except rounded-full/none", () => {
    expect(
      violations(
        /(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e))?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl))?(?![\w-])/,
        { inStrings: true },
      ),
    ).toEqual([]);
  });

  it("uses theme tokens, not hex colors, in components", () => {
    expect(violations(/#[0-9a-fA-F]{6}\b/, { tsxOnly: true })).toEqual([]);
  });

  it("stays on the type scale — no arbitrary text sizes", () => {
    expect(violations(/\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/)).toEqual([]);
  });
});
