---
name: design-system
description: PyOps web-app design system. Use BEFORE writing or modifying any UI in app/src — new pages, components, styling, tables, dialogs, empty/loading states, colors, or spacing. Ensures tokens and primitives are used instead of hand-rolled markup.
---

# PyOps design system

Read [`docs/design.md`](../../../docs/design.md) before writing UI — it is the
contract. The hard rules, as a checklist:

- **Primitives, not hand-rolled markup.** `Button`, `Input`, `Textarea`,
  `Select`, `Badge`, `Card`, `Dialog`, `Sheet` from `app/src/components/ui/`;
  `PageHeader`, `EmptyState`, `SidebarShell`, `GoodsSection`/`StatCell` from
  `app/src/components/`; `CursorHover` from `app/src/lib/hover.tsx`. Writing
  `className="border px-2 …"` on a raw `<button>`/`<input>` is a bug.
- **Tokens, not palette classes.** Never `text-emerald-300`, `bg-zinc-800`, or
  hex. Status hues: `success` (healthy/produced/live), `warning`
  (consumed/import/behind), `info` (stock/edit affordance), `surplus`
  (export/byproduct), `destructive` (deficit/starved). Recipe: `text-warning`,
  `bg-warning/10`, `border-warning/40`.
- **Square corners.** Don't write `rounded`/`rounded-md`/… (they render square
  anyway; the classes are noise). `rounded-full` only for status dots/spinners.
- **`text-sm` floor.** `text-xs` only for true fine print (unit suffixes,
  keycap hints, timestamps) — never primary data or whole rows.
- **One `PageHeader` per route**; page content padding `p-4`; section gap
  `gap-4`; group gap `gap-2`.
- **Every async surface ships loading (`Skeleton`), empty (`EmptyState` with a
  next step), and error states** — blank-while-pending is a bug.
- **Any width, any input.** Layouts work from ~360px to ultrawide (Tauri
  windows resize freely; Steam Deck = 1280×800 touch): capability parity at
  all widths, no sideways scroll, targets ≥ `h-8`, hover is enhancement only.
- **Localized `display` names only**; internal names are keys/tooltips.
- New recurring pattern → add a shared component, don't inline it twice.

The whole app complies as of the #17 migration — the file you're editing is
the example to match. Don't reintroduce raw palette classes, `rounded`, or
hand-rolled controls; lint enforcement is tracked in issue #103.
