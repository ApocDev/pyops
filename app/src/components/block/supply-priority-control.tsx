import { useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Check, Minus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import {
  getAdvancedSupplyPriorities,
  subscribeAdvancedSupplyPriorities,
  SUPPLY_PRIORITY,
} from "#/lib/supply-priority.ts";

const presets = [
  {
    value: SUPPLY_PRIORITY.preferred,
    label: "Preferred",
    icon: ArrowUp,
    color: "text-success",
    help: "Preferred supply — use this block before Normal and Fallback suppliers.",
  },
  {
    value: SUPPLY_PRIORITY.normal,
    label: "Normal",
    icon: Minus,
    color: "text-muted-foreground",
    help: "Normal supply — use after Preferred and before Fallback suppliers.",
  },
  {
    value: SUPPLY_PRIORITY.fallback,
    label: "Fallback",
    icon: ArrowDown,
    color: "text-warning",
    help: "Fallback supply — use this block only after higher-priority suppliers.",
  },
] as const;

export function SupplyPriorityControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const normalized = Number.isFinite(value) ? value : SUPPLY_PRIORITY.normal;
  const advanced = useSyncExternalStore(
    subscribeAdvancedSupplyPriorities,
    getAdvancedSupplyPriorities,
    () => false,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const preset = presets.find((option) => option.value === normalized) ?? presets[1];
  const PriorityIcon = preset.icon;

  return advanced ? (
    <Input
      aria-label="Block supply priority"
      type="number"
      step="1"
      value={normalized}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
      className="h-7 w-16 px-1 text-right"
    />
  ) : (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) setTooltipOpen(false);
      }}
    >
      <Tooltip
        content={preset.help}
        open={!menuOpen && tooltipOpen}
        onOpenChange={(open) => {
          if (!menuOpen) setTooltipOpen(open);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Block supply priority: ${preset.label}`}
            className={preset.color}
          >
            <PriorityIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-36">
        {presets.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
              <Icon className={option.color} />
              {option.label}
              {option.value === normalized && <Check className="ml-auto" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
