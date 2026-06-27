import type { ModDrift } from "../server/dump.ts";

/** The categorized mod changes (added / removed / enabled / disabled / updated) as
 * labelled chip rows. Shared by the drift modal and the Settings drift card. */
export function DriftChanges({ drift }: { drift: ModDrift | null }) {
  if (!drift) return null;
  const rows = [
    {
      label: "added",
      tone: "text-emerald-300",
      names: drift.added.map((m) => `${m.name} ${m.version ?? ""}`.trim()),
    },
    { label: "removed", tone: "text-destructive", names: drift.removed.map((m) => m.name) },
    { label: "enabled", tone: "text-emerald-300", names: drift.enabled },
    { label: "disabled", tone: "text-amber-300", names: drift.disabled },
    {
      label: "updated",
      tone: "text-sky-300",
      names: drift.versionChanged.map((v) => `${v.name} ${v.from ?? "—"}→${v.to ?? "—"}`),
    },
  ].filter((r) => r.names.length > 0);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-baseline gap-1.5">
          <span className={`shrink-0 font-semibold ${r.tone}`}>
            {r.label} ({r.names.length})
          </span>
          {r.names.map((n) => (
            <span key={n} className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {n}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
