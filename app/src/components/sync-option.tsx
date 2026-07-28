import type { ReactNode } from "react";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { InfoHint } from "#/components/info-hint.tsx";

/** One opt-in toggle in the data-sync prompt (re-dump icons, reuse the existing
 * dump). A row rather than a bare checkbox because each option carries a short
 * label, an InfoHint explaining the cost, and an optional status line — the age
 * of a dump, or why an option is unavailable. */
export function SyncOption({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  status,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
  /** Secondary line under the label — state, not explanation. */
  status?: ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 border border-border bg-muted/30 p-2.5 text-sm ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50"
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      <span className="min-w-0 space-y-1">
        <span className="flex items-center gap-1.5">
          <span className="text-foreground">{label}</span>
          <InfoHint content={hint} />
        </span>
        {status && <span className="block text-muted-foreground">{status}</span>}
      </span>
    </label>
  );
}
