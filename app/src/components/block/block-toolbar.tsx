import { useStore } from "@tanstack/react-store";
import {
  Check,
  Copy,
  Download,
  Gamepad2,
  Grid2x2,
  Hammer,
  History,
  Power,
  Sparkles,
} from "lucide-react";
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
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { BlockHelpContent } from "./block-help-content.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
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
  autoFill,
  onExport,
  onOpenHistory,
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
  /** whole-block module auto-fill: rows with a differing suggested fill + apply */
  autoFill: { count: number; onApply: () => void };
  /** download this block as a shareable JSON file (#82) */
  onExport: () => void;
  /** open the snapshot-history drawer (#85) */
  onOpenHistory: () => void;
  showInGame: { pending: boolean; sent: boolean | null; onShow: () => void };
  buildCost: SolveResult["buildCost"] | undefined;
  onOpenIconPicker: () => void;
}) {
  const blockName = useStore(doc.store, (s) => s.blockName);
  const customIcon = useStore(doc.store, (s) => s.customIcon);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Tooltip
        label
        content={
          customIcon
            ? "Block icon (custom) — click to change or reset to auto"
            : "Block icon — follows the first goal; click to pick your own"
        }
      >
        <Button
          variant="outline"
          size="icon-lg"
          onClick={onOpenIconPicker}
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
      </Tooltip>
      <Input
        value={blockName}
        onChange={(e) => {
          const v = e.target.value;
          doc.setBlockName(v);
          // typing a name pins it; clearing it resumes auto-naming from the goal
          onNamePinned(v.trim().length > 0);
        }}
        placeholder="Auto-named from goal…"
        className={`w-56 font-semibold ${titleHealthCls}`}
      />
      <span className="flex w-14 items-center gap-1 text-xs text-muted-foreground">
        {saveState === "saving" ? (
          "Saving…"
        ) : saveState === "saved" ? (
          <>
            Saved <Check className="size-3" />
          </>
        ) : (
          ""
        )}
      </span>
      <Tooltip label content="Copy setup — copy this block's recipe/module setup to the clipboard">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onCopySetup}
          className="text-muted-foreground"
        >
          <Copy className="size-4" />
        </Button>
      </Tooltip>
      {autoFill.count > 0 && (
        <Tooltip
          label
          content={`Auto-fill modules — apply the suggested fill (prod where allowed, else speed to the whole-machine floor, rest efficiency) to ${autoFill.count} row${autoFill.count === 1 ? "" : "s"}`}
        >
          <Button variant="outline" size="sm" onClick={autoFill.onApply} className="text-info">
            <Sparkles className="size-4" /> {autoFill.count}
          </Button>
        </Tooltip>
      )}
      <Tooltip
        label
        content="Export block — download this block as a shareable JSON file (import it from Settings → Backup & share)"
      >
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onExport}
          className="text-muted-foreground"
        >
          <Download className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip
        label
        content="Snapshots — this block's restore points: snapshot now, diff against the current state, restore"
      >
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onOpenHistory}
          className="text-muted-foreground"
        >
          <History className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip
        label
        content="Open in game — show this block as an in-game build sheet; click a building there for a configured blueprint (needs the bridge)"
      >
        <Button
          variant="outline"
          size="icon-sm"
          onClick={showInGame.onShow}
          disabled={showInGame.pending}
          className="text-muted-foreground"
        >
          <Gamepad2 className={`size-4 ${showInGame.pending ? "animate-pulse" : ""}`} />
        </Button>
      </Tooltip>
      <Tooltip
        label
        content={
          blockEnabled
            ? "Disable block — keep it here but exclude it from every factory-wide total"
            : "Enable block — count this block in the factory totals again"
        }
      >
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onToggleEnabled}
          className={
            !blockEnabled
              ? "border-warning/60 bg-warning/10 text-warning hover:bg-warning/20"
              : "text-muted-foreground"
          }
        >
          <Power className="size-4" />
        </Button>
      </Tooltip>
      {!blockEnabled && (
        <Tooltip content="Excluded from factory totals">
          <Badge className="border-transparent bg-warning/15 font-semibold text-warning">
            Disabled
          </Badge>
        </Tooltip>
      )}
      {buildCost && buildCost.buildings.length > 0 && (
        <Sheet>
          <Tooltip
            label
            content="Building summary — the buildings + one-time materials to construct this block"
          >
            <SheetTrigger asChild>
              <Button variant="outline" size="icon-sm" className="text-muted-foreground">
                <Hammer className="size-4" />
              </Button>
            </SheetTrigger>
          </Tooltip>
          <SheetContent side="right" className="w-96 max-w-[92vw] font-mono">
            <SheetHeader>
              <SheetTitle>Building summary</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                One-time build costs — separate from per-second flows.
                <InfoHint content="The buildings to construct this block, and the one-time materials to build them — a shopping list." />
              </p>
              <div>
                <FieldLabel className="mb-1.5">Buildings</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {buildCost.buildings.map((b) => (
                    <span key={b.name} className={cellChip}>
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
                      <span key={m.name} className={cellChip}>
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
        <span className="text-sm text-warning">Game not connected</span>
      )}
      {showInGame.sent === true && (
        <span className="flex items-center gap-1 text-sm text-success">
          Opened in game <Check className="size-3" />
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Legend cls={linkStyle.target} label="Goal" />
        <Legend cls={linkStyle.linked} label="Linked" />
        <Legend cls={linkStyle.import} label="Raw in" />
        <Legend cls={craftableStyle} label="Craftable" />
        <Legend cls={linkStyle.export} label="Export" />
      </span>
      <HelpButton title="What is a block?">
        <BlockHelpContent />
      </HelpButton>
    </div>
  );
}
