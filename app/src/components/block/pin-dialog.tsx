import { useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Icon } from "../../lib/icons";
import type { BlockDocStore } from "./doc-store.ts";
import type { SolveResult } from "./solve-view.ts";

/** Pin editor for one recipe row (#91): fixed building count (always run
 * exactly N — supply-push), built cap (at most N — the reality ceiling), and
 * consumer share pins (this row takes a % of an ingredient's in-block
 * production — the byproduct-routing gesture). One count-or-cap pin per row;
 * one share pin per ingredient. */
export function PinDialog({
  doc,
  recipe,
  res,
  onClose,
}: {
  doc: BlockDocStore;
  recipe: string;
  res: SolveResult | undefined;
  onClose: () => void;
}) {
  const pins = useStore(doc.store, (s) => s.pins);
  const rowPin = pins.find((p) => p.kind !== "share" && p.recipe === recipe) as
    | { kind: "count" | "cap"; recipe: string; count: number }
    | undefined;
  const sharePins = pins.filter(
    (p): p is { kind: "share"; recipe: string; item: string; share: number } =>
      p.kind === "share" && p.recipe === recipe,
  );
  const drainPins = pins.filter(
    (p): p is { kind: "drain"; recipe: string; item: string } =>
      p.kind === "drain" && p.recipe === recipe,
  );
  const display = res?.recipeDisplay?.[recipe] ?? recipe;
  const row = res?.rows.find((r) => r.recipe === recipe);
  const [kind, setKind] = useState<"count" | "cap">(rowPin?.kind ?? "count");
  const [count, setCount] = useState(
    rowPin?.count ?? Math.max(1, Math.ceil(row?.machine?.count ?? 1)),
  );
  // share targets: the row's inputs that something in-block produces (routing a
  // share of a pure import makes no sense)
  const producedHere = new Set(res?.rows.flatMap((r) => r.products.map((p) => p.name)) ?? []);
  const shareable = (row?.ingredients ?? []).filter((c) => producedHere.has(c.name));
  const [shareItem, setShareItem] = useState(sharePins[0]?.item ?? shareable[0]?.name ?? "");
  const [sharePct, setSharePct] = useState(
    Math.round((sharePins.find((p) => p.item === shareItem)?.share ?? 1) * 100),
  );
  const label = (name: string) => res?.display?.[name] ?? name;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[28rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <Icon kind="recipe" name={recipe} size="sm" noHover noTitle />
            Pins — {display}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-3 text-sm">
          <div>
            <FieldLabel>Building count</FieldLabel>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant={kind === "count" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("count")}
                title="always run exactly this many buildings — supply-push (surplus exports)"
              >
                exactly
              </Button>
              <Button
                variant={kind === "cap" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("cap")}
                title="at most this many buildings (what's physically built) — the solve fits inside and the diagnosis reports the shortfall when it can't"
              >
                at most
              </Button>
              <Input
                type="number"
                min="0"
                step="1"
                value={count}
                onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="h-8 w-20"
              />
              <Button
                size="sm"
                onClick={() => {
                  doc.setPin({ kind, recipe, count });
                  doc.note(
                    `Pin "${display}" ${kind === "count" ? "at exactly" : "to at most"} ${count} buildings`,
                  );
                  onClose();
                }}
              >
                pin
              </Button>
              {rowPin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    doc.clearPin(recipe);
                    doc.note(`Unpin "${display}"`);
                    onClose();
                  }}
                >
                  clear
                </Button>
              )}
            </div>
            {rowPin && (
              <div className="mt-1 text-muted-foreground">
                currently {rowPin.kind === "count" ? "exactly" : "at most"} {rowPin.count}
              </div>
            )}
          </div>

          {shareable.length > 0 && (
            <div>
              <FieldLabel>Route a share of an input</FieldLabel>
              <p className="mt-0.5 text-muted-foreground">
                This row takes a fixed % of an item&apos;s in-block production (after exactly-pinned
                consumers take theirs) — the byproduct-routing gesture.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Select value={shareItem} onValueChange={setShareItem}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue placeholder="input…" />
                  </SelectTrigger>
                  <SelectContent>
                    {shareable.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {label(c.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={sharePct}
                  onChange={(e) =>
                    setSharePct(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))
                  }
                  className="h-8 w-16"
                />
                <span className="text-muted-foreground">%</span>
                <Button
                  size="sm"
                  disabled={!shareItem}
                  onClick={() => {
                    doc.setPin({ kind: "share", recipe, item: shareItem, share: sharePct / 100 });
                    doc.note(`Route ${sharePct}% of "${label(shareItem)}" into "${display}"`);
                    onClose();
                  }}
                >
                  route
                </Button>
              </div>
              {drainPins.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {drainPins.map((p) => (
                    <span key={p.item} className="flex items-center gap-1.5">
                      drains all surplus {label(p.item)} (nothing exports)
                      <button
                        onClick={() => {
                          doc.clearPin(recipe, { item: p.item });
                          doc.note(`Stop draining "${label(p.item)}" into "${display}"`);
                          onClose();
                        }}
                        className="text-muted-foreground underline hover:text-foreground"
                      >
                        clear
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {sharePins.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {sharePins.map((p) => (
                    <span key={p.item} className="flex items-center gap-1.5">
                      takes {Math.round(p.share * 100)}% of {label(p.item)}
                      <button
                        onClick={() => {
                          doc.clearPin(recipe, { item: p.item });
                          doc.note(`Stop routing "${label(p.item)}" into "${display}"`);
                          onClose();
                        }}
                        className="text-muted-foreground underline hover:text-foreground"
                      >
                        clear
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
