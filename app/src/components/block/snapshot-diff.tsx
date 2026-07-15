/**
 * Snapshot diff view (#85): what changed between a snapshot and the current
 * editor state, in the same from → to visual language as the coherence page's
 * scale-plan drawer. Presentational — the sheet fetches the diff (computed by
 * lib/block-diff via snapshotDiffFn, display names resolved server-side).
 */
import type { Goal } from "../../db/schema.ts";
import type { BlockDiff } from "../../lib/block-diff";
import { Icon } from "../../lib/icons";
import { fmtReactorLayout } from "../../lib/reactor";

type Refs = Record<string, { kind: "item" | "fluid" | "recipe" | "technology"; display: string }>;

const fmtRate = (n: number) => String(+n.toFixed(3));
const goalLabel = (g: Goal) =>
  g.stock != null ? `keep ${fmtRate(g.stock)} on hand` : `${fmtRate(g.rate)}/s`;

export function SnapshotDiffView({
  diff,
  refs,
  recipeRefs,
  nameChange,
}: {
  diff: BlockDiff;
  /** good refs (goals, machines, fuels, modules, beacons, dispositions, spoil) */
  refs: Refs;
  /** recipe refs — a separate namespace, since a recipe may share its internal
   * name with the good it produces (recipe `coal-gas` vs fluid `coal-gas`, #113) */
  recipeRefs: Refs;
  /** snapshot name vs the current editor name (the doc diff doesn't carry it) */
  nameChange: { from: string; to: string } | null;
}) {
  const display = (n: string) => refs[n]?.display ?? n;
  const NameChip = ({ name, recipe }: { name: string; recipe?: boolean }) => {
    const r = (recipe ? recipeRefs : refs)[name];
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {r && <Icon kind={r.kind} name={name} size="sm" />}
        <span className="truncate" title={name}>
          {r?.display ?? name}
        </span>
      </span>
    );
  };
  const FromTo = ({ from, to }: { from: string; to: string }) => (
    <span className="shrink-0 tabular-nums">
      <span className="text-muted-foreground">{from}</span>
      <span className="text-muted-foreground"> → </span>
      <span className="text-foreground">{to}</span>
    </span>
  );
  const Row = ({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 py-0.5 text-sm">
      <span className="min-w-0 flex-1">{left}</span>
      {right}
    </div>
  );

  if (diff.unchanged && !nameChange) {
    return (
      <p className="py-1 text-sm text-muted-foreground italic">
        Identical to the current state — restoring would change nothing.
      </p>
    );
  }

  return (
    <div className="space-y-3 py-1">
      {nameChange && (
        <DiffSection title="Name">
          <Row left={<FromTo from={nameChange.from} to={nameChange.to} />} />
        </DiffSection>
      )}

      {(diff.goals.added.length > 0 ||
        diff.goals.removed.length > 0 ||
        diff.goals.changed.length > 0) && (
        <DiffSection title="Goals">
          {diff.goals.added.map((g) => (
            <Row
              key={`a-${g.name}`}
              left={<NameChip name={g.name} />}
              right={<span className="shrink-0 text-success">+ {goalLabel(g)}</span>}
            />
          ))}
          {diff.goals.removed.map((g) => (
            <Row
              key={`r-${g.name}`}
              left={<NameChip name={g.name} />}
              right={<span className="shrink-0 text-destructive">− was {goalLabel(g)}</span>}
            />
          ))}
          {diff.goals.changed.map((c) => (
            <Row
              key={`c-${c.name}`}
              left={<NameChip name={c.name} />}
              right={<FromTo from={goalLabel(c.from)} to={goalLabel(c.to)} />}
            />
          ))}
        </DiffSection>
      )}

      {(diff.recipes.added.length > 0 ||
        diff.recipes.removed.length > 0 ||
        diff.recipes.enabled.length > 0 ||
        diff.recipes.disabled.length > 0) && (
        <DiffSection title="Recipes">
          {diff.recipes.added.map((r) => (
            <Row
              key={`a-${r}`}
              left={<NameChip name={r} recipe />}
              right={<span className="shrink-0 text-success">Added</span>}
            />
          ))}
          {diff.recipes.removed.map((r) => (
            <Row
              key={`r-${r}`}
              left={<NameChip name={r} recipe />}
              right={<span className="shrink-0 text-destructive">Removed</span>}
            />
          ))}
          {diff.recipes.enabled.map((r) => (
            <Row
              key={`e-${r}`}
              left={<NameChip name={r} recipe />}
              right={<span className="shrink-0 text-success">Re-enabled</span>}
            />
          ))}
          {diff.recipes.disabled.map((r) => (
            <Row
              key={`d-${r}`}
              left={<NameChip name={r} recipe />}
              right={<span className="shrink-0 text-warning">Disabled</span>}
            />
          ))}
        </DiffSection>
      )}

      {diff.picks.length > 0 && (
        <DiffSection title="Machines & modules">
          {diff.picks.map((p) => (
            <div key={p.recipe} className="py-0.5">
              <div className="text-sm">
                <NameChip name={p.recipe} recipe />
              </div>
              <div className="space-y-0.5 pl-4">
                {p.machine && (
                  <Row
                    left={<span className="text-muted-foreground">Machine</span>}
                    right={
                      <FromTo
                        from={p.machine.from ? display(p.machine.from) : "auto"}
                        to={p.machine.to ? display(p.machine.to) : "auto"}
                      />
                    }
                  />
                )}
                {p.fuel && (
                  <Row
                    left={<span className="text-muted-foreground">Fuel</span>}
                    right={
                      <FromTo
                        from={p.fuel.from ? display(p.fuel.from) : "auto"}
                        to={p.fuel.to ? display(p.fuel.to) : "auto"}
                      />
                    }
                  />
                )}
                {p.modules && (
                  <Row
                    left={<span className="text-muted-foreground">Modules</span>}
                    right={
                      <FromTo from={moduleLabel(p.modules.from)} to={moduleLabel(p.modules.to)} />
                    }
                  />
                )}
                {p.beacons && (
                  <Row
                    left={<span className="text-muted-foreground">Beacons</span>}
                    right={
                      <FromTo from={beaconLabel(p.beacons.from)} to={beaconLabel(p.beacons.to)} />
                    }
                  />
                )}
                {p.reactorLayout && (
                  <Row
                    left={<span className="text-muted-foreground">Reactor layout</span>}
                    right={
                      <FromTo
                        from={layoutLabel(p.reactorLayout.from)}
                        to={layoutLabel(p.reactorLayout.to)}
                      />
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </DiffSection>
      )}

      {diff.dispositions.length > 0 && (
        <DiffSection title="Dispositions">
          {diff.dispositions.map((c) => (
            <Row
              key={c.name}
              left={<NameChip name={c.name} />}
              right={<FromTo from={c.from ?? "auto"} to={c.to ?? "auto"} />}
            />
          ))}
        </DiffSection>
      )}

      {diff.made.length > 0 && (
        <DiffSection title="Made in block">
          {diff.made.map((c) => (
            <Row
              key={c.name}
              left={<NameChip name={c.name} />}
              right={
                <FromTo from={c.from ? "Made here" : "Free"} to={c.to ? "Made here" : "Free"} />
              }
            />
          ))}
        </DiffSection>
      )}

      {diff.pins.length > 0 && (
        <DiffSection title="Pins">
          {diff.pins.map((c) => (
            <Row
              key={c.name}
              left={<NameChip name={c.name.split(" « ")[0]} recipe />}
              right={<FromTo from={c.from ?? "—"} to={c.to ?? "—"} />}
            />
          ))}
        </DiffSection>
      )}

      {diff.spoilRates.length > 0 && (
        <DiffSection title="Incidental spoilage estimates">
          {diff.spoilRates.map((c) => (
            <Row
              key={c.name}
              left={<NameChip name={c.name} />}
              right={
                <FromTo
                  from={c.from != null ? `${fmtRate(c.from)}/s` : "—"}
                  to={c.to != null ? `${fmtRate(c.to)}/s` : "—"}
                />
              }
            />
          ))}
        </DiffSection>
      )}
    </div>
  );
}

const moduleLabel = (m: string[] | null) =>
  m == null ? "auto" : m.length === 0 ? "none" : `${m.length} set`;
const beaconLabel = (b: { count: number }[]) =>
  b.length === 0 ? "none" : `${b.reduce((s, x) => s + x.count, 0)} beacons`;
const layoutLabel = (l: { x: number; y: number } | null) =>
  l == null ? "1×1" : fmtReactorLayout(l);

function DiffSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-sm font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
