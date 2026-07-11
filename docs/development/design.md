---
title: Design system
description: Apply PyOps visual foundations, shared primitives, responsive anatomy, interaction states, accessibility, and verification rules.
outline: [2, 3]
---

# Design system

The PyOps interface is an industrial planning tool: dense, square, readable, and driven by
semantic status. Theme tokens live in `app/src/styles.css`; shared primitives live in
`app/src/components/ui/`; larger recurring patterns live in `app/src/components/`.

The governing rule is simple: do not hand-roll a control or pattern the system already
provides. Per-page classes should describe layout. Shared components and tokens should own
appearance and interaction behavior.

## Principles

- **Dense but readable.** Prefer compact structure and clear hierarchy, never tiny primary
  text.
- **Industrial and square.** Use flat surfaces, borders, and meaningful status color rather
  than decorative rounding or shadow.
- **Semantic before local.** A warning, import, export, or success uses the same token and
  primitive everywhere.
- **Localized names.** Visible item, fluid, recipe, machine, and technology labels use their
  display names. Internal IDs are keys and optional diagnostic detail.
- **Progressive explanation.** Keep the working surface concise. Put a clause in an
  `InfoHint`, a concept in a `HelpButton` drawer, and a full workflow in the documentation.
- **Capability parity.** Responsive layouts may relocate controls but never remove a
  capability.
- **State is designed.** Loading, empty, error, disabled, stale, and success states are part
  of the feature rather than cleanup work.

## Foundations

### Typography

Geist Mono is the base application font. Manrope remains available through `font-sans`, but
the product is deliberately monospace-forward.

| Role                             | Classes                                                               | Rule                                                              |
| -------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Page title                       | `text-lg font-semibold tracking-tight`                                | Exactly one, through `PageHeader`                                 |
| Card or section title            | `text-sm font-semibold tracking-wide uppercase text-muted-foreground` | Prefer `CardTitle`                                                |
| Body, controls, labels, and data | `text-sm`                                                             | Minimum readable size                                             |
| Fine print                       | `text-xs`                                                             | Timestamps, units, key hints, and truly supplementary detail only |

If removing a line would hide primary information, it is not fine print.

Inputs and textareas render at `text-base` on narrow screens to prevent iOS focus zoom, then
use `md:text-sm` at desktop widths.

### Color

Use semantic theme tokens only. Raw Tailwind palette classes and component hex values are
forbidden because they drift between pages and do not adapt to light and dark themes.

| Token                                                           | Meaning                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `background` / `foreground`                                     | Page surface and ordinary text                                         |
| `card`, `popover`, `muted`, `accent`, `border`, `input`, `ring` | Shared surface and chrome layers                                       |
| `primary`                                                       | Brand accent, primary action, and selected navigation                  |
| `destructive`                                                   | Failure, deficit, starvation, and destructive action                   |
| `success`                                                       | Healthy, satisfied, produced, and live-connected                       |
| `warning`                                                       | Attention, consumption, imports, stale state, and degraded behavior    |
| `info`                                                          | Neutral notices, stock flows, edit affordances, and explicit overrides |
| `surplus`                                                       | Exports, byproducts, and positive net material flow                    |

Tinted states pair one hue across text, border, and a low-opacity background, for example
`text-warning border-warning/40 bg-warning/15`. Color is redundant: an icon, label, or
value must still communicate the state.

Theme selection is a browser preference managed by `app/src/lib/theme.ts`. A pre-paint
script applies it before React renders, avoiding a light/dark flash. New surfaces must work
in both themes even though dark mode is the primary tuning surface.

### Shape and elevation

`--radius` is zero. Do not add `rounded*` classes except `rounded-full` for circular status
dots and spinners.

Separate ordinary surfaces with `border`, `bg-card`, and `bg-muted`, not shadow. Floating
menus, context menus, hover cards, and tooltips use an opaque `bg-popover`, visible ring or
border, and shadow so they remain legible over dense tables. Large `Dialog` and `Sheet`
surfaces may use the shared translucent backdrop treatment supplied by their primitives.

Do not weaken overlay opacity, border, or focus treatment from an individual page.

### Spacing

The shared rhythm is:

- page content: `p-4`;
- between sections and cards: `gap-4`;
- ordinary control groups: `gap-2`;
- tight icon/label groups: `gap-1.5`;
- card header: `px-3 py-2`;
- card content: `p-3`.

Use spacing to express grouping before adding more borders or labels.

### Icons

Use Lucide for application glyphs, normally at `size-4`. Small button variants can use
`size-3.5` or `size-3`; the `Button` primitive sizes direct SVG children automatically.

Use `Icon` from `app/src/lib/icons.tsx` for Factorio sprites. Choose its named
`xs`/`sm`/`md`/`lg` sizes rather than arbitrary pixels. `Icon` includes the rich cursor
hover by default; use `RawIcon` for bare rendering or `noHover` when another surface owns
the explanation.

## Shared primitives

### Actions and forms

| Need                                 | Component                                                         |
| ------------------------------------ | ----------------------------------------------------------------- |
| Clickable action                     | `Button` and its semantic variants/sizes                          |
| Text or numeric input                | `Input`, `Textarea`                                               |
| Choose one value                     | Radix-backed `Select`                                             |
| Boolean form field                   | `Checkbox` with `Label`; `Switch` for a persistent on/off setting |
| Mutually exclusive mode              | `Segmented`                                                       |
| Independent toggle/filter            | `Button variant="toggle"` with `aria-pressed`                     |
| Field-group eyebrow                  | `FieldLabel`; use `Label` for the actual form control label       |
| Triggered action list                | `DropdownMenu`                                                    |
| Pointer-anchored right-click actions | `ContextMenu` and `ContextMenuItem`                               |

Never replace these with a styled native button, input, select, or clickable span. The
primitive carries keyboard, focus, disabled, and theme behavior that local markup tends to
miss.

### Surfaces and feedback

| Need                               | Component                                        |
| ---------------------------------- | ------------------------------------------------ |
| Titled panel                       | `Card`, `CardHeader`, `CardTitle`, `CardContent` |
| Persistent state message           | `Callout`; use `variant="strip"` inside a card   |
| Compact state or count             | `Badge` with semantic token classes              |
| Completed-action feedback          | `toast()` rendered by the root `Toaster`         |
| Focused edit or choice             | responsive `Dialog` with `DialogBody`            |
| Long side panel                    | `Sheet`                                          |
| Large or irreversible confirmation | `ConfirmDialog`                                  |
| Loading placeholder                | `Skeleton`                                       |
| No content                         | `EmptyState`                                     |
| Query loading/error/empty/data     | `QueryBoundary`                                  |
| Retryable inline failure           | `QueryError`                                     |

A toast reports something that happened. A dialog requests a decision. A callout explains a
persistent state. Do not interchange them.

Small undo-logged deletes happen immediately and offer the shared undo toast. Block,
project, Companion-mod, and conversation deletion use `ConfirmDialog` because their scope
or reversibility differs. Never use `window.confirm`.

Dialogs center at `md` and above and dock to the bottom on narrower screens. Put scrolling
content in `DialogBody`; keep title and action regions outside it.

### Explanation and hover

| Need                                          | Component                                 |
| --------------------------------------------- | ----------------------------------------- |
| One clause beside a label                     | `InfoHint`                                |
| Longer embedded concept help                  | `HelpButton` and its right-side drawer    |
| Short interactive explanation                 | keyboard-accessible `Tooltip`             |
| Rich Factorio detail                          | `CursorHover` / `CursorCard`              |
| Full value for non-interactive truncated text | native `title={display}` on the text span |

Do not wrap a hover-enabled game `Icon` in a tooltip; choose one owner. Icon buttons need an
`aria-label`, and a tooltip that shares a trigger with a menu or dialog must close while the
larger surface is open.

### Lists, search, and tables

Use `FilterInput`, `useFilteredList`, and `FilterEmptyState` for searchable lists. The shared
search ranks localized names first while allowing internal IDs as a hidden fallback. Avoid
per-page lowercase substring filters.

Goods and statistics tables use `GoodsSection`, `StatCell`, `StatTableHeader`, or
`StatSortHeader`. Desktop headers are hidden at narrow widths; each `StatCell` becomes a
labeled mobile value. `usePersistedSorting` and `usePersistedFold` store browser-local table
preferences where applicable.

The lead cell owns the flexible width and truncation. Numeric/stat columns remain fixed and
right-aligned on desktop. Do not preserve a wide desktop row by forcing horizontal scroll
on mobile.

### Keyboard shortcuts

Register shortcuts through `useHotkey` in `app/src/lib/hotkeys.ts`. `mod+` resolves to
Command on macOS and Control elsewhere. Shortcuts are suppressed inside text fields unless
an app-global chord explicitly opts into `allowInInputs`.

Every registration includes a description so the `?` shortcut-help sheet can discover it.
Do not add route-level `window.addEventListener("keydown", …)` handlers.

## Page anatomy

Every route has one `PageHeader` directly inside its `p-4` scroll region. It owns the title,
optional concise description, primary actions, and toolbar. The header stays sticky with an
opaque background and bottom divider.

The application shell remains fixed; route content scrolls in an inner
`min-h-0 flex-1 overflow-auto` region. Controls that operate on a long data surface remain
in the sticky header or another deliberate sticky row.

List-and-detail routes use `SidebarShell`: a fixed rail at desktop widths and a Sheet drawer
below `md`. Do not create a second responsive sidebar implementation.

Prose and forms use a readable `max-w-*`. Data grids may add columns at wide breakpoints
instead of stretching individual rows across an ultrawide monitor.

## Responsive behavior

Design continuously from approximately 360 px through ultrawide layouts. Breakpoints change
anatomy, not capability.

- Base styles are the narrow layout: one column, stacked labeled values, bottom-sheet
  dialogs, and navigation in a drawer.
- `md` is the main anatomy switch: table headers appear, dialogs center, and side drawers
  can become rails.
- `lg` and larger widths may add columns and whitespace but no new controls.
- Every desktop action remains available from a menu, drawer, or rearranged control on
  mobile.
- Names truncate with an accessible full-name path; data tables collapse instead of making
  the page scroll sideways.
- Text remains `text-sm` or larger. Density comes from stacking and grouping, not shrinking
  type.
- Touch support does not depend on width. Use at least the shared `h-8` target and adequate
  spacing. Hover-only behavior must be supplementary or have a tap/click path.
- Height matters. The 1280×800 Steam Deck layout needs lean fixed chrome and independently
  scrolling content.

`app/e2e/responsive.e2e.ts` captures every route across desktop, Steam Deck, tablet, and
phone viewports and asserts that tablet and phone routes do not overflow horizontally.

## Async and interaction states

Every asynchronous surface must define:

- **Loading** — skeletons that approximate the final geometry and avoid layout jumps;
- **Empty** — a title, one sentence, and an action when the user can resolve it;
- **Error** — a localized message in the failed surface with a retry path.

Route-level waits and failures use the root `RoutePending` and `RouteError` defaults unless
the route requires a more specific shell. In-body queries normally use `QueryBoundary`.

Filtering to zero results is not the same as having no data. `FilterEmptyState` names the
query and offers to clear it.

Interactive elements need visible hover and `focus-visible` states. Shared primitives
already provide the ring behavior; preserve it. Use short color transitions when they help
state comprehension and avoid decorative motion.

Disabled and locked controls must be visibly unavailable, not merely a slightly different
tint. Explain the reason through nearby text or a tooltip when it is not evident from the
label.

## Accessibility and content

- Use native semantic elements through the shared primitives.
- Every icon-only control has an accessible name.
- Form labels are programmatically associated with their controls.
- Status never depends on color alone.
- Menus, dialogs, sheets, and tooltips preserve Radix keyboard and dismissal behavior.
- Visible game names are localized. Internal IDs may appear in diagnostic detail or a hover
  but never replace a known display name.
- Keep inline explanations short and operational. Link the user documentation for complete
  workflows rather than duplicating it in the app.

## Mechanical enforcement

`app/src/design-system.test.ts` scans TypeScript and TSX sources for:

- raw Tailwind palette classes;
- corner-rounding classes other than full circles or explicit none;
- component hex colors;
- arbitrary text sizes.

The test runs in the staged-file Vite+ checks configured by `app/vite.config.ts`. A true
exception must be narrowly documented in the test's exception list rather than hidden with
an evasive class construction.

For a UI change, run `vp check`, the relevant component tests, and the main Playwright flow.
Inspect dark and light themes and at least one narrow viewport. When a new pattern appears
twice, extract the shared component before it becomes a page convention.
