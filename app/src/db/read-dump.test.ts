import { describe, expect, test } from "vite-plus/test";
import { parseByTopLevelKey } from "./read-dump.ts";

const parse = (s: string) => parseByTopLevelKey(Buffer.from(s, "utf8"));

describe("parseByTopLevelKey", () => {
  test("matches JSON.parse on structural characters inside strings, escapes, and UTF-8", () => {
    const src = {
      recipe: {
        "tricky-}{": { name: 'quote " and \\ backslash', icons: [{ icon: "]}[{" }], energy: 0.5 },
      },
      "item-group": { é: { order: "日本語 ✓", nested: [[1, 2], { a: null }] } },
      "mod-data": {},
    };
    expect(parse(JSON.stringify(src, null, "\t"))).toEqual(src);
  });

  test("handles scalar top-level values and an empty object", () => {
    expect(parse('{ "a": 1 , "b": true, "c": "x,}" }')).toEqual({ a: 1, b: true, c: "x,}" });
    expect(parse("{}")).toEqual({});
  });
});
