import { useStore } from "@tanstack/react-store";
import { Check, Copy, Download, Gamepad2, Grid2x2, Hammer, Power, Star } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#/components/ui/sheet.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Icon } from "../../lib/icons";
import { Legend } from "./legend.tsx";
import { craftableStyle, linkStyle } from "./item-chip.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { SolveResult } from "./solve-view.ts";
import { fmtAmt } from "./format.ts";
import { cellChip } from "./styles.ts";

/** The editor's header row: block icon + name (auto-named from the goal until
 * the user types one), the save indicator, the toolbar actions (copy setup,
 * show in game, enable/disable, building summary), the chip-colour legend, and
 * the "what is a block?" help drawer. */
export function BlockToolbar({
  doc,
  blockIcon,
  titleHealthCls,
  saveState,
  onNamePinned,
  blockEnabled,
  onToggleEnabled,
  onCopySetup,
  onExport,
  showInGame,
  buildCost,
  onOpenIconPicker,
}: {
  doc: BlockDocStore;
  /** the block's face (#40): explicit pick, else the first goal's icon */
  blockIcon: { kind: string; name: string } | null;
  /** health tint for the name input (red broken/infeasible, amber warnings) */
  titleHealthCls: string;
  saveState: "idle" | "saving" | "saved";
  /** typing a name pins it; clearing resumes auto-naming from the goal */
  onNamePinned: (pinned: boolean) => void;
  blockEnabled: boolean;
  onToggleEnabled: () => void;
  onCopySetup: () => void;
  /** download this block as a shareable JSON file (#82) */
  onExport: () => void;
  showInGame: { pending: boolean; sent: boolean | null; onShow: () => void };
  buildCost: SolveResult["buildCost"] | undefined;
  onOpenIconPicker: () => void;
}) {
  const blockName = useStore(doc.store, (s) => s.blockName);
  const customIcon = useStore(doc.store, (s) => s.customIcon);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon-lg"
        onClick={onOpenIconPicker}
        title={
          customIcon
            ? "block icon (custom) — click to change or reset to auto"
            : "block icon — follows the first goal; click to pick your own"
        }
        className={customIcon ? "border-primary/60" : ""}
      >
        {blockIcon ? (
          <Icon
            kind={blockIcon.kind as "item" | "fluid"}
            name={blockIcon.name}
            size="md"
            noHover
            noTitle
          />
        ) : (
          <Grid2x2 className="size-4 text-muted-foreground" />
        )}
      </Button>
      <Input
        value={blockName}
        onChange={(e) => {
          const v = e.target.value;
          doc.setBlockName(v);
          // typing a name pins it; clearing it resumes auto-naming from the goal
          onNamePinned(v.trim().length > 0);
        }}
        placeholder="auto-named from goal…"
        className={`w-56 font-semibold ${titleHealthCls}`}
      />
      <span className="flex w-14 items-center gap-1 text-xs text-muted-foreground">
        {saveState === "saving" ? (
          "saving…"
        ) : saveState === "saved" ? (
          <>
            saved <Check className="size-3" />
          </>
        ) : (
          ""
        )}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onCopySetup}
        title="Copy setup — copy this block's recipe/module setup to the clipboard"
        className="text-muted-foreground"
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onExport}
        title="Export block — download this block as a shareable JSON file (import it from Settings → Backup & share)"
        className="text-muted-foreground"
      >
        <Download className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={showInGame.onShow}
        disabled={showInGame.pending}
        title="Open in game — show this block as an in-game build sheet; click a building there for a configured blueprint (needs the bridge)"
        className="text-muted-foreground"
      >
        <Gamepad2 className={`size-4 ${showInGame.pending ? "animate-pulse" : ""}`} />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onToggleEnabled}
        title={
          blockEnabled
            ? "Disable block — keep it here but exclude it from every factory-wide total"
            : "Enable block — count this block in the factory totals again"
        }
        className={
          !blockEnabled
            ? "border-warning/60 bg-warning/10 text-warning hover:bg-warning/20"
            : "text-muted-foreground"
        }
      >
        <Power className="size-4" />
      </Button>
      {!blockEnabled && (
        <Badge className="border-transparent bg-warning/15 font-semibold text-warning">
          disabled — excluded from factory totals
        </Badge>
      )}
      {buildCost && buildCost.buildings.length > 0 && (
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              title="Building summary — the buildings + one-time materials to construct this block"
              className="text-muted-foreground"
            >
              <Hammer className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-96 max-w-[92vw] font-mono">
            <SheetHeader>
              <SheetTitle>Building summary</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
              <p className="text-sm text-muted-foreground">
                The buildings to construct this block, and the one-time materials to build them — a
                shopping list, separate from the per-second flows.
              </p>
              <div>
                <FieldLabel className="mb-1.5">Buildings</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {buildCost.buildings.map((b) => (
                    <span key={b.name} className={cellChip} title={b.display}>
                      <Icon kind="item" name={b.name} size="sm" />
                      <span className="tabular-nums">×{b.count}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel className="mb-1.5">Materials to build them</FieldLabel>
                {buildCost.materials.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    — (no build recipe found for these buildings)
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {buildCost.materials.map((m) => (
                      <span key={m.name} className={cellChip} title={m.display}>
                        <Icon kind={m.kind as "item" | "fluid"} name={m.name} size="sm" />
                        <span className="tabular-nums">{fmtAmt(m.amount)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
      {showInGame.sent === false && (
        <span className="text-sm text-warning">game not connected</span>
      )}
      {showInGame.sent === true && (
        <span className="flex items-center gap-1 text-sm text-success">
          opened in game <Check className="size-3" />
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Legend cls={linkStyle.target} label="goal" />
        <Legend cls={linkStyle.linked} label="linked" />
        <Legend cls={linkStyle.import} label="raw in" />
        <Legend cls={craftableStyle} label="craftable" />
        <Legend cls={linkStyle.export} label="export" />
        <span
          className="text-muted-foreground/70"
          title="right-click any item for actions (make a goal, lock as sizing input, force import/export/balance, locate in game). Alt-click quick-cycles the disposition."
        >
          · right-click = menu
        </span>
      </span>
      <HelpButton title="What is a block?">
        <p>
          A block is <span className="text-foreground">one production unit you design</span>: pick
          the recipes to make one or more goal goods, and the solver works out how many of each
          building you need (fractional counts and all).
        </p>
        <div>
          <div className="font-semibold text-foreground">Goals</div>
          <p className="mt-1">
            A block can target several products at once — each goal has a{" "}
            <span className="text-foreground">target rate</span> and the block is sized so that good
            comes out at exactly that rate. Click a goal&apos;s rate to edit it, and click its unit
            to cycle <span className="text-foreground">/s → /min → /h</span> — enter science as
            10/min or a slow bootstrap as 0.5/h; the unit sticks per goal while the solver works in
            per-second underneath. Not everything is throughput:{" "}
            <span className="text-foreground">right-click a goal → Keep in stock</span> turns it
            into a buffer goal (&quot;keep 100 on hand&quot;) with a refill window (default 10m,
            click to cycle) — machines are sized to rebuild the buffer within the window, and the
            factory ledger badges the flow <span className="text-info">↻ stock</span>. So a single
            &quot;logistics&quot; block can make belts @10/s, undergrounds @4/s and splitters @2/s
            side by side. The first goal <span className="text-info">names the block</span>, anchors
            the scale tools, and is the default icon;{" "}
            <Star className="inline size-3.5 text-foreground" /> moves a goal to the front. Click
            the icon next to the block&apos;s name to pick any item or fluid as its icon instead. A
            good you don&apos;t target isn&apos;t a goal — it falls out as a byproduct (export).
          </p>
          <p className="mt-1">
            If your goals can&apos;t all be met at once (e.g. two goods locked to a fixed ratio by
            one recipe), the block is <span className="text-destructive">infeasible</span> and says
            so — add a recipe to make more of the short good, or change a rate.
          </p>
        </div>
        <p>
          <span className="text-foreground">How it solves.</span> Given the goals, every other good
          in the block is one of: <span className="text-foreground">balanced</span> (made and used
          inside the block), <span className="text-foreground">imported</span> (brought in from
          outside or another block), or <span className="text-foreground">exported</span> (surplus
          that leaves). The solver sets each recipe&apos;s run-rate to satisfy that — it&apos;s a
          linear system, and it handles Py&apos;s cyclic recipe chains.
        </p>
        <p>
          <span className="text-foreground">You drive it, not an optimizer.</span> You choose the
          recipes and how to split a good between competing ones; PyOps just solves the system you
          describe. <span className="text-foreground">Right-click</span> any item to make it a goal,
          lock it as a sizing input, or force import / export / balance — the colored legend shows
          each item&apos;s current disposition.
        </p>
        <div>
          <div className="font-semibold text-foreground">Sub-blocks</div>
          <p className="mt-1">
            <span className="text-foreground">Right-click a recipe&apos;s name</span> to start a
            sub-block — a named, collapsible group of rows. Add more rows from the same menu or by
            dragging them onto the header; collapse it and the whole chain reads as one line showing
            its <span className="text-foreground">net flows</span> (what goes in, what comes out —
            intermediates cancel), machines and power. Display-only: the solve is exactly the same
            expanded, collapsed, or dissolved. Drag the header to move the whole chain; double-click
            its name to rename; × ungroups (the rows stay).
          </p>
        </div>
        <div>
          <div className="font-semibold text-foreground">Toolbar (next to the name)</div>
          <ul className="mt-1 space-y-1.5">
            <li className="flex items-start gap-2">
              <Copy className="mt-0.5 size-4 shrink-0 text-foreground" />
              <span>copies this block&apos;s recipe/module setup to the clipboard;</span>
            </li>
            <li className="flex items-start gap-2">
              <Download className="mt-0.5 size-4 shrink-0 text-foreground" />
              <span>
                exports this block as a shareable JSON file — import it into any project from{" "}
                <span className="text-foreground">Settings → Backup &amp; share</span>;
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Gamepad2 className="mt-0.5 size-4 shrink-0 text-foreground" />
              <span>
                shows this block as an in-game build sheet — click a building there for a configured
                blueprint;
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Hammer className="mt-0.5 size-4 shrink-0 text-foreground" />
              <span>
                <span className="text-foreground">Building summary</span> — opens a drawer listing
                the buildings and the one-time materials to construct this block (a shopping list,
                kept out of the way of the per-second flows).
              </span>
            </li>
          </ul>
        </div>
        <p>
          Per-machine <span className="text-foreground">modules / beacons</span> are tuned in the
          block body to cut building count. The Cybersyn request-combinator generator now lives in
          the in-game mod panel.
        </p>
      </HelpButton>
    </div>
  );
}
