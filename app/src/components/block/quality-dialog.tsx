import { useStore } from "@tanstack/react-store";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import type { RowQuality } from "../../db/schema";
import { Icon, RawIcon } from "../../lib/icons";
import { NORMAL_QUALITY } from "../../lib/quality";
import { useQualityLadder, type QualityStep } from "../../lib/use-quality-ladder";
import type { BlockDocStore } from "./doc-store.ts";
import type { SolveResult } from "./solve-view.ts";

/** Quality editor for one recipe row (#267): the range of qualities the row
 * runs at, and the quality of its machine and of the modules in the machine.
 * Each change applies at once, so the solve updates while the dialog is open. */
export function QualityDialog({
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
  const setting = useStore(doc.store, (s) => s.rowQuality[recipe]);
  const { ladder, top } = useQualityLadder();
  const row = res?.rows.find((r) => r.recipe === recipe);
  const display = res?.recipeDisplay?.[recipe] ?? recipe;
  const rank = (name: string | undefined) =>
    Math.max(
      0,
      ladder.findIndex((step) => step.name === (name ?? NORMAL_QUALITY)),
    );
  const lo = rank(setting?.min);
  const hi = Math.max(lo, rank(setting?.max ?? setting?.min));
  const topDisplay = ladder.find((step) => step.name === top)?.display ?? top;

  const apply = (next: RowQuality) => {
    doc.setRowQuality(recipe, next);
    doc.note(`Set quality of "${display}"`);
  };
  // Moving one end past the other drags the other along, so the range stays valid.
  const setLowest = (name: string) =>
    apply({ ...setting, min: name, max: ladder[Math.max(rank(name), hi)].name });
  const setHighest = (name: string) =>
    apply({ ...setting, min: ladder[Math.min(rank(name), lo)].name, max: name });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <Icon kind="recipe" name={recipe} size="sm" noHover noTitle />
            Quality — {display}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="text-sm">
          <div className="space-y-2">
            <FieldLabel>Runs at</FieldLabel>
            {row?.qualityFixed && (
              <Callout tone="info">
                This recipe always runs at normal. Its products can still come out at a higher
                quality.
              </Callout>
            )}
            <TierPicker
              label="Lowest"
              ladder={ladder}
              value={ladder[lo]?.name ?? NORMAL_QUALITY}
              disabled={row?.qualityFixed}
              onChange={setLowest}
            />
            <TierPicker
              label="Highest"
              ladder={ladder}
              value={ladder[hi]?.name ?? NORMAL_QUALITY}
              disabled={row?.qualityFixed}
              onChange={setHighest}
            />
            <p className="text-muted-foreground">
              Each quality in the range gets its own machine count, with the same machine and
              modules.
            </p>
          </div>
          <TierPicker
            label="Machine"
            ladder={ladder}
            value={setting?.machine ?? NORMAL_QUALITY}
            onChange={(machine) => apply({ ...setting, machine })}
          />
          <TierPicker
            label="Modules in the machine"
            ladder={ladder}
            value={setting?.modules ?? NORMAL_QUALITY}
            onChange={(modules) => apply({ ...setting, modules })}
          />
          {row?.qualityUseless && (
            <Callout tone="warning">
              The quality effect on this row does nothing. Its products can&apos;t get quality, or
              it already runs at the best quality you&apos;ve unlocked.
            </Callout>
          )}
          {row?.qualityCapped && (
            <Callout tone="warning">
              Some of these qualities aren&apos;t researched by the planning horizon yet, so the row
              plans at {topDisplay}.
            </Callout>
          )}
        </DialogBody>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border p-3">
          <Button variant="ghost" onClick={() => apply({})}>
            Reset to normal
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One quality choice: the chain as a strip of quality icons, the chosen
 * quality's name beside the label. */
function TierPicker({
  label,
  ladder,
  value,
  disabled,
  onChange,
}: {
  label: string;
  ladder: QualityStep[];
  value: string;
  disabled?: boolean;
  onChange: (name: string) => void;
}) {
  const chosen = ladder.find((step) => step.name === value)?.display ?? value;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span>{chosen}</span>
      </div>
      <Segmented
        aria-label={label}
        value={value}
        onValueChange={onChange}
        className="flex w-full [&>button]:flex-1"
        options={ladder.map((step) => ({
          value: step.name,
          disabled,
          label: (
            <>
              <RawIcon kind="quality" name={step.name} size="sm" noTitle />
              <span className="sr-only">{step.display}</span>
            </>
          ),
        }))}
      />
    </div>
  );
}
