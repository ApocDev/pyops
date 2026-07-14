import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Input } from "#/components/ui/input.tsx";
import { formatQty } from "../../lib/format";
import { parseRateInput } from "./format.ts";

/** Stock-goal refill windows (#38): the machines are sized to rebuild the buffer
 * within the window (rate = stock / window). Click-to-cycle presets. */
const STOCK_WINDOWS = [300, 600, 1800, 3600];
const fmtWindow = (s: number) => (s >= 3600 ? `${s / 3600}h` : `${s / 60}m`);

/** "keep N" editor for a stock goal (#38): click the count to edit it, click the
 * window to cycle how fast the buffer refills. The stored rate stays derived. */
export function EditableStock({
  stock,
  window: win,
  onChange,
  onWindowChange,
}: {
  stock: number;
  window: number;
  onChange: (n: number) => void;
  onWindowChange: (secs: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cycle = () =>
    onWindowChange(STOCK_WINDOWS[(STOCK_WINDOWS.indexOf(win) + 1) % STOCK_WINDOWS.length]);
  if (!editing) {
    return (
      <span className="flex flex-col items-center gap-0.5 leading-tight tabular-nums">
        <button
          onClick={() => {
            setDraft(String(stock));
            setEditing(true);
          }}
          title="keep this many on hand — click to edit"
          className="whitespace-nowrap hover:text-info"
        >
          keep {formatQty(stock)}
        </button>
        <button
          onClick={cycle}
          title="refill window — machines are sized to rebuild the buffer within this time; click to cycle"
          className="flex items-center gap-0.5 whitespace-nowrap text-muted-foreground hover:text-info"
        >
          <RefreshCw className="size-3" />
          {fmtWindow(win)}
        </button>
      </span>
    );
  }
  const commit = () => {
    const parsed = parseRateInput(draft); // magnitude suffixes (k/M/G/T) welcome here too
    if (parsed && parsed.value > 0) onChange(parsed.value);
    setEditing(false);
  };
  return (
    <Input
      autoFocus
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-7 w-16 border-info/60 px-1 text-center"
    />
  );
}
