import { useState } from "react";
import { Input } from "#/components/ui/input.tsx";
import { formatQty } from "../../lib/format";
import { parseRateInput } from "./format.ts";

/** Compact finite-quantity editor used in a temporary campaign goal cell. */
export function EditableCampaignQuantity({
  quantity,
  onChange,
}: {
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!editing)
    return (
      <button
        onClick={() => {
          setDraft(String(quantity));
          setEditing(true);
        }}
        title="Finite campaign quantity — click to edit"
        className="whitespace-nowrap font-medium tabular-nums hover:text-info"
      >
        Make {formatQty(quantity)}
      </button>
    );

  const commit = () => {
    const parsed = parseRateInput(draft);
    if (parsed && parsed.value > 0) onChange(parsed.value);
    setEditing(false);
  };
  return (
    <Input
      autoFocus
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setEditing(false);
      }}
      className="h-7 w-20 border-info/60 px-1 text-center"
    />
  );
}
