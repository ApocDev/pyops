# Design system

The shared visual/interaction spec for the web app (issue #17). Every UI change —
new page, new component, touched-up route — follows this document. The base layer
(theme tokens in `app/src/styles.css`, primitives in `app/src/components/ui/`)
enforces most of it by default; this doc is the contract for everything the base
layer can't enforce.

**The prime directive: don't hand-roll what the system provides.** If you're
writing `className="rounded border px-2 …"` on a `<button>`, `<input>`, or
`<span>` that acts like a badge, stop — use the primitive. If a pattern recurs
and no primitive covers it, add one under `components/` and use it everywhere,
rather than inlining it twice.

## Principles

- **Industrial, dense, square.** PyOps is an ops tool for a factory game: flat
  surfaces, square corners, monospace-forward type, high information density.
  Decoration only where it carries meaning (status color, severity, live-ness).
- **Consistency is the default, not opt-in.** Tokens and primitives carry the
  design; per-page CSS should be layout, not styling.
- **Readable floor.** Body and data text is `text-sm` or larger — see Typography.
- **Localized names, always.** UI shows the `display` name; internal names
  (`iron-pulp-07`) are keys only, surfaced at most in a tooltip/`title`.

## Foundations

### Typography

Base font is Geist Mono (set on `html`); `font-sans` (Manrope) is available but
the app deliberately reads monospace. The scale:

| Role | Classes | Notes |
| --- | --- | --- |
| Page title | `text-lg font-semibold tracking-tight` | Exactly one per page, via `PageHeader`. |
| Section / card title | `text-sm font-semibold tracking-wide uppercase text-muted-foreground` | This is `CardTitle`; use it (or match it) for section headers. |
| Body, data, labels, buttons | `text-sm` | The floor. Tables, badges, inputs, menus — all `text-sm`. |
| Fine print | `text-xs` | Only true fine print: supplementary annotation whose loss costs nothing — unit suffixes, keycap hints, timestamps. Never primary data, never a whole row or table. |

If you're unsure whether something is fine print, it isn't — use `text-sm`.

### Color

Use theme tokens only. Never raw palette classes (`text-emerald-300`,
`bg-zinc-800`) or hex values — they don't adapt to light/dark and drift shade by
shade. The tokens (defined in `styles.css`, light + dark values each):

| Token | Meaning in PyOps |
| --- | --- |
| `background` / `foreground` | Page surface and default text. |
| `card`, `popover`, `muted`, `accent`, `border`, `input`, `ring` | Standard shadcn surfaces/chrome. |
| `primary` | Brand orange (`#d2842d`); primary actions, active nav. |
| `destructive` | Deficit, starved, failing, delete actions. |
| `success` | Healthy / goal met / produced / live-connected. |
| `warning` | Attention: consumed side, imports, behind-plan, degraded. |
| `info` | Neutral notice: stock-refill flows, edit affordances, forced overrides. |
| `surplus` | Exports, byproducts, positive net — material leaving a block. |

Usage recipe for the status hues: text `text-warning`, tinted fill
`bg-warning/10`–`/20`, border `border-warning/40`. Pair a tinted fill with text
of the same hue, not with plain foreground. Status color is a redundant channel:
the state must also be legible from an icon, label, or value.

### Shape & elevation

- **Square corners everywhere.** `--radius` is `0`, so stray `rounded`/
  `rounded-md` classes render square anyway — but don't write them. The only
  rounding is `rounded-full` for status dots and spinners.
- Flat surfaces separated by `border` (1px) and background steps
  (`bg-card`, `bg-muted`), not shadows. Shadows only on floating layers
  (popovers, dropdowns, hover cards).

### Spacing

- Page content padding: `p-4`.
- Between sections/cards: `gap-4` (or `mb-4`).
- Within a group (toolbar buttons, form rows): `gap-2`; tight clusters `gap-1.5`.
- Card interior: `CardHeader` is `px-3 py-2`, `CardContent` is `p-3` — keep
  custom panels on the same rhythm.

### Iconography

- **UI glyphs**: lucide-react. Default `size-4`; `size-3.5`/`size-3` inside
  `sm`/`xs` buttons (the `Button` primitive already handles this for direct
  `svg` children). Align with text via flex `items-center gap-1`–`1.5`.
- **Game sprites**: the `Icon` component (`lib/icons.tsx`) with token sizes
  (`xs`/`sm`/`md`/`lg` — tuned once in `styles.css`, never ad-hoc pixel sizes).
  `Icon` shows a rich hover card by default; `RawIcon` is the bare sprite;
  `noHover` opts out.

## Components

Reach for these before writing markup:

| Need | Use |
| --- | --- |
| Any clickable action | `Button` (`ui/button.tsx`) — variants `default`/`outline`/`secondary`/`ghost`/`destructive`/`link`, sizes down to `icon-xs`. No hand-rolled `<button className=…>`. |
| Text/number entry | `Input`, `Textarea` (`text-base` on mobile so iOS doesn't zoom, `md:text-sm` on desktop). |
| Choose-one | `Select` (Radix). |
| Yes/no tick | `Checkbox` (`ui/checkbox.tsx`) — pairs with `Label`; `Switch` stays the on/off setting control. |
| Action menu on a trigger | `DropdownMenu` (`ui/dropdown-menu.tsx`) — Radix; keyboard nav and outside-dismiss built in. |
| Status chip / count | `Badge` — semantic tint via `className` (e.g. `bg-warning/15 text-warning border-transparent`). |
| Status message / banner | `Callout` (`ui/callout.tsx`) — `tone` success/warning/info/destructive/primary, default icon per tone, optional `title`/`action`; `variant="strip"` for full-bleed rows inside cards. |
| Transient feedback | `toast()` (`lib/toast-store.ts`) — non-blocking bottom-right queue rendered by the `Toaster` in `ui/toast.tsx` (mounted once in the root). Tones default/success/destructive, auto-dismiss, optional action button ("Undo", "Reload"); callable from anywhere, not just components. For feedback about a completed/failed action — anything needing a decision is a `Dialog`, anything persistent a `Callout`. |
| Segmented choice / on-off toggle | `Button variant="toggle"` with `aria-pressed` — active state styles itself from the aria attribute. |
| Micro caption over a field group | `FieldLabel` (`ui/label.tsx`) — the uppercase muted eyebrow; `Label` stays the `text-sm` form label. |
| Panel with a title | `Card` + `CardHeader`/`CardTitle`/`CardContent`. |
| Confirmation / focused edit | `Dialog` (`ui/dialog.tsx`) — centered modal at `md+`, docks to the bottom as a sheet below. Never a bare centered modal on phones. |
| Slide-over / drawer / collapsed rail | `Sheet`. |
| Page title row + toolbar | `PageHeader` (`components/page-header.tsx`). |
| "Nothing here yet" | `EmptyState` (`components/empty-state.tsx`). |
| Loading placeholder | `Skeleton` (`ui/skeleton.tsx`). |
| Hover detail | `CursorHover`/`CursorCard` (`lib/hover.tsx`) — the app's one tooltip system. |
| Right-click menu | `ContextMenu`/`ContextMenuItem` (`components/context-menu.tsx`) — anchored panel + backdrop; items are icon+label rows. |
| Keyboard shortcut | `useHotkey` (`lib/hotkeys.ts`) — the one global hotkey registry. `mod+` combos resolve to Cmd on macOS / Ctrl elsewhere; combos are suppressed while focus is in a text field unless the registration opts in with `allowInInputs` (reserved for app-global chords like Ctrl+K). Every registration carries a `description` for a future shortcut help sheet. Don't hand-roll `window.addEventListener("keydown", …)` for shortcuts. |
| Tabular goods/rates/stats | `GoodsSection` (`components/goods-table.tsx`) + `StatCell`, with `StatTableHeader` (`components/stat-table.tsx`) for the static header row. The app's one data-table anatomy: a muted `hidden md:flex` header row, then rows with a lead cell (icon + truncating name, `flex-1`) and fixed-width right-aligned `StatCell` columns that collapse to a labeled grid on mobile. New tables follow it; prose tables in assistant markdown are the one exception. |

## Page anatomy

- **Scroll model**: the nav shell is fixed; page content scrolls in its own
  container (`min-h-0 flex-1 overflow-auto`). Don't let the page body scroll the
  header away; toolbars that drive the content below them stay visible
  (sticky or in the fixed header region).
- Every route starts with one `PageHeader` (title, optional description,
  right-aligned actions, toolbar as children). No per-page heading styles.
- List-plus-detail pages use `SidebarShell` (rail on desktop, drawer on mobile).

## Form factors

The app runs on phones, tablets, desktops, and the Steam Deck, and the Tauri
window resizes to anything in between. Design for a **continuous width range,
not device classes** — every layout must be sane at every width from ~360px to
ultrawide, including the transitions.

- **Breakpoint semantics.** Base styles are the narrow layout: single column,
  stacked labeled cards (`StatCell` collapses to this), bottom-sheet dialogs,
  nav in a drawer. `md` (768px) is *the* anatomy switch: table header rows
  appear, dialogs center, drawers become rails. `lg`+ only adds columns and
  width — never new capabilities.
- **Capability parity at every width.** Controls may relocate (into a `Sheet`,
  a menu, an overflow) but never disappear. Anything doable at 1920px is doable
  at 390px.
- **No sideways scroll, ever.** Names truncate (with `title`/hover for the full
  text), tables collapse to stacked cards; wide content never pushes the page.
  Enforced at tablet/phone widths by `app/e2e/responsive.e2e.ts`.
- **Readability doesn't shrink with the window.** The `text-sm` floor and full
  localized names hold at all widths; density comes from stacking and
  collapsing layout, not smaller type.
- **Touch is orthogonal to width.** Tablets and the Deck are touch *at desktop
  widths*, so never gate touch affordances on breakpoint. Interactive targets
  are at least the `h-8` button with `gap-2` between neighbors; hover (cursor
  cards, hover-revealed buttons) is an enhancement layer — every hover
  affordance needs a click/tap path, or its content must be supplementary.
- **Height matters too.** The Deck is 1280×800: desktop width, short. Keep
  fixed chrome to lean single rows, scroll content in its inner container, and
  don't stack tall sticky regions.
- **Ultrawide**: cap prose and forms with `max-w-*`; let data grids grow
  columns (the `2xl:grid-cols-3` pattern) rather than stretching rows.

The e2e matrix (`responsive.e2e.ts`) screenshots every route at 1920×1080,
1280×800 (= Steam Deck), 834 and 390 wide, and asserts no sideways scroll at
tablet/phone widths — layout work keeps that suite green.

## Interaction states

Every async surface ships all three states — a surface that renders blank while
loading, empty, or failed is a bug:

- **Loading**: `Skeleton` blocks that approximate the final layout (no spinner
  walls, no layout jump). Route-level data uses the route's `pendingComponent`.
- **Empty**: `EmptyState` with a title, one sentence of guidance, and — when the
  user can fix the emptiness — an action (`Button` or link). "No results" from a
  filter says so and offers to clear the filter.
- **Error**: say what failed, inline where the data would be (route-level:
  `errorComponent`). Use `text-destructive` + retry affordance where sensible.

Affordances: interactive elements get visible hover (`hover:bg-muted` family)
and focus (`focus-visible:ring-1 ring-ring/50` — baked into the primitives)
states. Transitions are short (`transition-colors`) and only where they aid
comprehension; nothing decorative.

## Status

Every route and shared component follows this system (the #17 migration is
complete): zero raw palette classes, zero stray `rounded`, primitives
everywhere, and all modals ride the responsive `Dialog`. Keep it that way —
new code follows this document, and mechanical lint enforcement is tracked in
issue #103.
