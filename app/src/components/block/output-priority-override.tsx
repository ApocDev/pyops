import { useSyncExternalStore } from "react";
import { Input } from "#/components/ui/input.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import {
  getAdvancedSupplyPriorities,
  subscribeAdvancedSupplyPriorities,
} from "#/lib/supply-priority.ts";

export function OutputPriorityOverride({
  inherited,
  value,
  onChange,
}: {
  inherited: number;
  value: number | undefined;
  onChange: (value: number | null) => void;
}) {
  const advanced = useSyncExternalStore(
    subscribeAdvancedSupplyPriorities,
    getAdvancedSupplyPriorities,
    () => false,
  );
  if (!advanced) return null;

  return (
    <Tooltip content="Advanced per-output override. Clear it to inherit the block priority.">
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        Output
        <Input
          aria-label="Output supply priority override"
          type="number"
          step="1"
          placeholder={String(inherited)}
          value={value ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : Number(event.target.value) || 0)
          }
          className="h-7 w-16 px-1 text-right"
        />
        {value != null && (
          <Button variant="ghost" size="xs" onClick={() => onChange(null)}>
            Inherit
          </Button>
        )}
      </span>
    </Tooltip>
  );
}
