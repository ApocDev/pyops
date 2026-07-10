import { ItemChip } from "./item-chip.tsx";

/** Derived spoil-result chip shown beside the configured source product. */
export function IncidentalSpoilageChip({
  result,
  resultDisplay,
  rate,
  onEdit,
}: {
  result: string;
  resultDisplay?: string | null;
  rate: number;
  onEdit: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
      <ItemChip
        name={result}
        kind="item"
        display={resultDisplay}
        rate={rate}
        link="export"
        incidental
        onClick={onEdit}
      />
    </span>
  );
}
