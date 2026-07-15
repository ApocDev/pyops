import { describe, expect, it } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

function lowercaseStaticStarts(node: ts.Expression): { node: ts.Node; value: string }[] {
  if (ts.isStringLiteralLike(node)) {
    return startsLowercase(node.text) ? [{ node, value: node.text }] : [];
  }
  if (ts.isTemplateExpression(node)) {
    return startsLowercase(node.head.text) ? [{ node, value: node.head.text }] : [];
  }
  if (ts.isParenthesizedExpression(node)) return lowercaseStaticStarts(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...lowercaseStaticStarts(node.whenTrue), ...lowercaseStaticStarts(node.whenFalse)];
  }
  return [];
}

/** High-signal static copy only. Dynamic/localized content and sentence fragments mixed
 * with expressions are deliberately outside this guard. */
function casingViolations(): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".tsx") || f.endsWith(".test.tsx")) continue;
    const sourceText = readFileSync(join(SRC, f), "utf8");
    const source = ts.createSourceFile(
      f,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const report = (node: ts.Node, value: string) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      out.push(`${f}:${line}:${value.trim()}`);
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxAttribute(node) &&
        CASED_ATTRIBUTES.has(node.name.getText(source)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        startsLowercase(node.initializer.text)
      ) {
        report(node, node.initializer.text);
      }
      if (
        ts.isJsxAttribute(node) &&
        CASED_ATTRIBUTES.has(node.name.getText(source)) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        for (const hit of lowercaseStaticStarts(node.initializer.expression)) {
          report(hit.node, hit.value);
        }
      }

      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        [
          "description",
          "empty",
          "header",
          "hint",
          "label",
          "message",
          "prompt",
          "text",
          "title",
        ].includes(node.name.text) &&
        ts.isStringLiteralLike(node.initializer) &&
        startsLowercase(node.initializer.text)
      ) {
        report(node, node.initializer.text);
      }

      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(source);
        const meaningful = node.children.filter(
          (child) => !ts.isJsxText(child) || child.text.trim().length > 0,
        );
        if (CASED_ELEMENTS.has(tag) && meaningful.length > 0 && meaningful.every(ts.isJsxText)) {
          const text = meaningful.map((child) => child.text).join(" ");
          if (startsLowercase(text)) report(node, text);
        }
        if (
          CASED_ELEMENTS.has(tag) &&
          meaningful[0] &&
          ts.isJsxExpression(meaningful[0]) &&
          meaningful[0].expression
        ) {
          for (const hit of lowercaseStaticStarts(meaningful[0].expression)) {
            report(hit.node, hit.value);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
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
