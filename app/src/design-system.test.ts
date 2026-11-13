import { describe, expect, it } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor, type ESTree } from "vite-plus";

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

const CASED_ELEMENTS = new Set([
  "AlertDialogTitle",
  "Badge",
  "Button",
  "CardTitle",
  "Callout",
  "ContextMenuItem",
  "DialogTitle",
  "DropdownMenuItem",
  "FieldLabel",
  "SelectItem",
  "SheetTitle",
  "TabsTrigger",
  "button",
]);
const CASED_ATTRIBUTES = new Set([
  "aria-label",
  "content",
  "description",
  "empty",
  "emptyText",
  "extraText",
  "hint",
  "label",
  "placeholder",
  "prompt",
  "title",
]);

function startsLowercase(value: string): boolean {
  const text = value.trim();
  return /^[a-z]/.test(text) && !text.startsWith("e.g.");
}

function lowercaseStaticStarts(node: ESTree.Expression): { node: ESTree.Node; value: string }[] {
  const text = staticString(node);
  if (text !== undefined) return startsLowercase(text) ? [{ node, value: text }] : [];
  if (node.type === "TemplateLiteral") {
    const head = node.quasis[0].value.cooked ?? "";
    return startsLowercase(head) ? [{ node, value: head }] : [];
  }
  if (node.type === "ParenthesizedExpression") return lowercaseStaticStarts(node.expression);
  if (node.type === "ConditionalExpression") {
    return [...lowercaseStaticStarts(node.consequent), ...lowercaseStaticStarts(node.alternate)];
  }
  return [];
}

/** The text of a string literal or a template literal with no `${}` parts. */
function staticString(node: ESTree.Node | null): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? undefined;
  }
  return undefined;
}

const CASED_PROPERTIES = new Set([
  "description",
  "empty",
  "header",
  "hint",
  "label",
  "message",
  "prompt",
  "text",
  "title",
]);

/** High-signal static copy only. Dynamic/localized content and sentence fragments mixed
 * with expressions are deliberately outside this guard. */
function casingViolations(): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".tsx") || f.endsWith(".test.tsx")) continue;
    const sourceText = readFileSync(join(SRC, f), "utf8");
    const { program } = parseSync(f, sourceText, { lang: "tsx" });
    const report = (node: ESTree.Node, value: string) => {
      const line = sourceText.slice(0, node.start).split("\n").length;
      out.push(`${f}:${line}:${value.trim()}`);
    };
    new Visitor({
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !CASED_ATTRIBUTES.has(node.name.name)) return;
        if (node.value?.type === "Literal" && startsLowercase(node.value.value)) {
          report(node, node.value.value);
        }
        if (
          node.value?.type === "JSXExpressionContainer" &&
          node.value.expression.type !== "JSXEmptyExpression"
        ) {
          for (const hit of lowercaseStaticStarts(node.value.expression)) {
            report(hit.node, hit.value);
          }
        }
      },
      Property(node) {
        if (
          node.computed ||
          node.key.type !== "Identifier" ||
          !CASED_PROPERTIES.has(node.key.name)
        ) {
          return;
        }
        const text = staticString(node.value);
        if (text !== undefined && startsLowercase(text)) report(node, text);
      },
      JSXElement(node) {
        const { name } = node.openingElement;
        if (name.type !== "JSXIdentifier" || !CASED_ELEMENTS.has(name.name)) return;
        const meaningful = node.children.filter(
          (child) => child.type !== "JSXText" || child.value.trim().length > 0,
        );
        if (meaningful.length > 0 && meaningful.every((child) => child.type === "JSXText")) {
          const text = meaningful.map((child) => child.value).join(" ");
          if (startsLowercase(text)) report(node, text);
        }
        const first = meaningful[0];
        if (
          first?.type === "JSXExpressionContainer" &&
          first.expression.type !== "JSXEmptyExpression"
        ) {
          for (const hit of lowercaseStaticStarts(first.expression)) {
            report(hit.node, hit.value);
          }
        }
      },
    }).visit(program);
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

  it("authors static interface copy in sentence case", () => {
    expect(casingViolations()).toEqual([]);
  });

  it("keeps card titles sentence-cased without local transform overrides", () => {
    expect(violations(/<CardTitle[^>]*\bnormal-case\b/, { tsxOnly: true })).toEqual([]);
  });

  it("keeps CSS casing transforms inside the FieldLabel primitive", () => {
    expect(
      violations(/\b(?:uppercase|lowercase|capitalize|normal-case)\b/, { inStrings: true }).filter(
        (hit) => !hit.startsWith("components/ui/label.tsx:"),
      ),
    ).toEqual([]);
  });
});
