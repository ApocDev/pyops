import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { fmtTemp } from "../../lib/format.ts";
import { setFavoriteFluidTemperatureFn } from "../../server/factorio.ts";

/** Text-only temperature choice embedded in an ingredient chip. The visible
 * value is either the recipe's accepted range or an exact produced variant;
 * the menu never accepts a temperature the reference data cannot produce. */
export function FluidTemperaturePicker({
  recipe,
  scope = "recipe",
  fluid,
  display,
  accepted,
  selected,
  favorite,
  options,
  onChange,
}: {
  recipe?: string;
  scope?: "recipe" | "goal";
  fluid: string;
  display: string;
  accepted: string;
  selected: number | null;
  favorite: number | null;
  options: number[];
  onChange: (temperature: number | null) => void;
}) {
  const qc = useQueryClient();
  const available = [...new Set(options)].sort((a, b) => a - b);
  const toggleFavorite = (temperature: number) => {
    void setFavoriteFluidTemperatureFn({
      data: { fluid, temperature: favorite === temperature ? null : temperature },
    }).then(() => {
      void qc.invalidateQueries({ queryKey: ["solve"] });
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          {...(scope === "goal"
            ? { "data-goal-temperature": fluid }
            : { "data-fluid-temperature": `${recipe}:${fluid}` })}
          aria-label={`${scope === "goal" ? "Goal temperature" : `Temperature for ${display} in ${recipe}`}: ${selected == null ? accepted : fmtTemp(selected)}`}
          title={`Choose the fluid temperature for this ${scope}`}
          className="text-sm tabular-nums text-muted-foreground hover:text-info"
        >
          {selected == null ? accepted : fmtTemp(selected)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Accepted temperature</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          {scope === "goal" ? "Goal range" : "Recipe range"} · {accepted}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {available.map((temperature) => (
          <DropdownMenuItem
            key={temperature}
            onSelect={() => onChange(temperature)}
            className="gap-3"
          >
            <span className="flex-1">{fmtTemp(temperature)}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`${favorite === temperature ? "Clear" : "Set"} ${fmtTemp(temperature)} as favorite for ${display}`}
              title={
                favorite === temperature
                  ? `Favorite temperature for ${display} — new recipes and goals use it. Click to clear.`
                  : `Set as the favorite temperature for ${display} (new recipes and goals use it)`
              }
              className={
                favorite === temperature
                  ? "text-warning"
                  : "text-muted-foreground hover:text-warning"
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(temperature);
              }}
            >
              <Star className="size-4" fill={favorite === temperature ? "currentColor" : "none"} />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
import { useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
