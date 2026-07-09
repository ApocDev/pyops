import { AlertTriangle, X } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Icon } from "../../lib/icons";
import { SortableRow } from "./sortable-row.tsx";

/** A recipe that no longer exists in the data: a labelled placeholder row
 * (preserved, not silently dropped) rather than a solved row. */
export function MissingRecipeRow({
  name,
  gridClass,
  onDrop,
}: {
  name: string;
  gridClass: string;
  onDrop: () => void;
}) {
  return (
    <SortableRow key={name} id={name}>
      {() => (
        <div className={`${gridClass} border-t border-border bg-destructive/10`}>
          <div className="flex min-w-0 items-center gap-2">
            <Icon kind="recipe" name={name} size="md" noTitle />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono" title={name}>
                {name}
              </span>
              <Tooltip content="this recipe isn't in the current data — re-enable its mod or re-import to restore it, or remove it">
                <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                  <AlertTriangle className="size-3" /> no longer exists
                </span>
              </Tooltip>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={onDrop}
              title="remove this missing recipe from the block"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </SortableRow>
  );
}
