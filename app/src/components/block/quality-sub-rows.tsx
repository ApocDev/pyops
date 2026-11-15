import { FieldLabel } from "#/components/ui/label.tsx";
import { Icon, RawIcon } from "../../lib/icons";
import { NORMAL_QUALITY } from "../../lib/quality";
import { useQualityLadder } from "../../lib/use-quality-ladder";
import { num } from "./format.ts";
import type { SolveResult } from "./solve-view.ts";

type Row = SolveResult["rows"][number];
type Flow = { name: string; kind: string; rate: number };

/** A recipe row's per-quality sub-rows (#267): one line per quality the row
 * runs at, with that quality's buildings, what they eat, and where their
 * output lands. Each line is one machine setup to build: every assembler is set
 * to one recipe quality. Read-only; the row above holds the controls. */
export function QualitySubRows({
  columns,
  machine,
  gridClass,
}: {
  columns: NonNullable<Row["qualityColumns"]>;
  machine: Row["machine"];
  gridClass: string;
}) {
  const { ladder } = useQualityLadder();
  const display = (q: string) => ladder.find((step) => step.name === q)?.display ?? q;
  return columns.map((c) => {
    const quality = c.quality ?? NORMAL_QUALITY;
    return (
      <div
        key={quality}
        data-quality-row={quality}
        className={`${gridClass} border-t border-border/60 bg-muted/20 text-sm`}
      >
        <div className="flex items-center gap-2 text-muted-foreground md:pl-8">
          <RawIcon kind="quality" name={quality} size="sm" noTitle />
          Runs at {display(quality)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FieldLabel className="w-full md:hidden">Machines</FieldLabel>
          {machine && (
            <span className="flex items-center gap-1.5 bg-muted/50 px-1.5 py-1 tabular-nums">
              <Icon kind="entity" name={machine.name} quality={machine.quality} size="md" />
              {num(c.machines)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FieldLabel className="w-full md:hidden">Ingredients</FieldLabel>
          {c.ingredients.map((f) => (
            <FlowChip key={f.name} flow={f} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FieldLabel className="w-full md:hidden">Products</FieldLabel>
          {c.products.map((f) => (
            <FlowChip key={f.name} flow={f} />
          ))}
        </div>
      </div>
    );
  });
}

/** One flow at one quality: the good's icon (badged above normal) and its rate. */
function FlowChip({ flow }: { flow: Flow }) {
  return (
    <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 tabular-nums">
      <Icon kind={flow.kind === "fluid" ? "fluid" : "item"} name={flow.name} size="md" />
      {num(flow.rate)}
    </span>
  );
}
