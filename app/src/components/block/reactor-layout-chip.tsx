import { Check, LayoutGrid } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import {
  fmtReactorLayout,
  reactorHeatMultiplier,
  REACTOR_LAYOUT_PRESETS,
  sameLayout,
  type ReactorLayout,
} from "../../lib/reactor";
import { num } from "./format.ts";
import { cellChip } from "./styles.ts";

/** Reactor-row layout chip (#94): shows the assumed x×y farm and the heat
 * multiplier its neighbour bonus yields ("2×2 ×3 heat"); click opens a preset
 * picker. Only rendered on rows whose machine is a reactor. */
export function ReactorLayoutChip({
  reactor,
  onPick,
}: {
  reactor: { layout: ReactorLayout; neighbourBonus: number; multiplier: number };
  onPick: (layout: ReactorLayout) => void;
}) {
  const pct = Math.round(reactor.neighbourBonus * 100);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={`Reactor farm ${fmtReactorLayout(reactor.layout)} — each adjacent working reactor adds +${pct}% heat, so this layout averages ×${num(reactor.multiplier)} heat per reactor (fuel stays per-reactor) · click to change the layout`}
          className={`${cellChip} text-warning`}
        >
          <LayoutGrid className="size-3.5" />
          <span className="font-semibold">{fmtReactorLayout(reactor.layout)}</span>
          {reactor.multiplier !== 1 && (
            <span className="text-muted-foreground">×{num(reactor.multiplier)} heat</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>
          Reactor farm layout — +{pct}% heat per adjacent reactor
        </DropdownMenuLabel>
        {REACTOR_LAYOUT_PRESETS.map((p) => {
          const mult = reactorHeatMultiplier(reactor.neighbourBonus, p);
          const current = sameLayout(p, reactor.layout);
          return (
            <DropdownMenuItem key={fmtReactorLayout(p)} onSelect={() => onPick(p)}>
              <Check className={`size-4 ${current ? "" : "invisible"}`} />
              <span className="font-semibold">{fmtReactorLayout(p)}</span>
              <span className="ml-auto pl-4 text-muted-foreground">×{num(mult)} heat</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
