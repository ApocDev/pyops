import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, Plus, X } from "lucide-react";
import { useState } from "react";
import { factoryPinsFn, setFactoryPinsFn } from "#/server/factorio.ts";
import { Icon } from "#/lib/icons.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { FactoryPinPickerDialog } from "./factory-pin-picker-dialog.tsx";

type PinRow = Awaited<ReturnType<typeof factoryPinsFn>>[number];

export function FactoryPinsCard({
  overrides,
  onOverride,
}: {
  overrides: Record<string, number>;
  onOverride: (good: string, rate: number) => void;
}) {
  const qc = useQueryClient();
  const pins = useQuery({ queryKey: ["factoryPins"], queryFn: () => factoryPinsFn() });
  const [picking, setPicking] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const save = useMutation({
    mutationFn: (
      rows: {
        good: string;
        kind: string;
        rate: number;
        source?: "explicit" | "terminal" | "stock" | "temporary";
      }[],
    ) => setFactoryPinsFn({ data: rows }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["factoryPins"] });
      await qc.invalidateQueries({ queryKey: ["factoryScenarioSnapshot"] });
    },
  });
  const rows = pins.data ?? [];
  const stockRows = rows.filter((pin) => pin.source === "stock");
  const temporaryRows = rows.filter((pin) => pin.source === "temporary");
  const derivedRows = [...stockRows, ...temporaryRows];
  const visibleRows = [
    ...rows.filter((pin) => pin.source !== "stock" && pin.source !== "temporary"),
    ...(showStock ? derivedRows : []),
  ];
  const persist = (next: PinRow[]) =>
    save.mutate(next.map(({ good, kind, rate, source }) => ({ good, kind, rate, source })));

  return (
    <>
      <Card>
        <CardHeader className="justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Factory pins</CardTitle>
            <InfoHint content="The only fixed whole-factory targets. Every other goal is solved from these demands." />
          </div>
          <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
            <Plus /> Pin good
          </Button>
        </CardHeader>
        {pins.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No factory pins"
            description="Pin a desired output before solving the factory."
          />
        ) : (
          <div className="divide-y divide-border">
            {visibleRows.map((pin) => {
              const value = overrides[pin.good] ?? pin.rate;
              return (
                <div key={pin.good} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Pin className="size-3.5 shrink-0 text-primary" />
                  <Icon
                    kind={pin.kind as "item" | "fluid"}
                    name={pin.good}
                    size="sm"
                    title={pin.display}
                  />
                  <span className="min-w-0 flex-1 truncate" title={pin.display}>
                    {pin.display}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={value}
                    disabled={pin.source === "temporary"}
                    title={
                      pin.source === "temporary"
                        ? "Edit this temporary campaign's quantity or duration in its block"
                        : undefined
                    }
                    onChange={(event) => onOverride(pin.good, Number(event.target.value) || 0)}
                    className="w-24 text-right"
                    aria-label={`${pin.display} factory pin`}
                  />
                  <span className="text-muted-foreground">/s</span>
                  {pin.source !== "stock" && pin.source !== "temporary" && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${pin.display} factory pin`}
                      title="Remove factory pin"
                      onClick={() => persist(rows.filter((row) => row.good !== pin.good))}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              );
            })}
            {derivedRows.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="m-2"
                onClick={() => setShowStock((current) => !current)}
              >
                {showStock ? "Hide" : "Show"} {derivedRows.length} derived stock/campaign targets
              </Button>
            )}
          </div>
        )}
      </Card>

      {picking && (
        <FactoryPinPickerDialog
          onClose={() => setPicking(false)}
          onPick={(good) => {
            setPicking(false);
            if (rows.some((pin) => pin.good === good.name)) return;
            persist([
              ...rows,
              { good: good.name, kind: good.kind, rate: 1, display: good.name, source: "explicit" },
            ]);
          }}
        />
      )}
    </>
  );
}
