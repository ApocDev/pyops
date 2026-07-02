import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { ModDrift } from "../server/dump.server.ts";

const chip = "bg-muted px-1.5 py-0.5 font-mono";

function Row({
  label,
  tone,
  count,
  children,
}: {
  label: string;
  tone: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`shrink-0 font-semibold ${tone}`}>
        {label} ({count})
      </span>
      {children}
    </div>
  );
}

/** The categorized mod changes (added / removed / enabled / disabled / updated) as
 * labelled chip rows. Shared by the drift modal and the Settings drift card. */
export function DriftChanges({ drift }: { drift: ModDrift | null }) {
  if (!drift) return null;
  const simple = [
    {
      label: "added",
      tone: "text-success",
      names: drift.added.map((m) => `${m.name} ${m.version ?? ""}`.trim()),
    },
    { label: "removed", tone: "text-destructive", names: drift.removed.map((m) => m.name) },
    { label: "enabled", tone: "text-success", names: drift.enabled },
    { label: "disabled", tone: "text-warning", names: drift.disabled },
  ].filter((r) => r.names.length > 0);

  if (simple.length === 0 && drift.versionChanged.length === 0) return null;

  return (
    <div className="space-y-1.5 text-sm">
      {simple.map((r) => (
        <Row key={r.label} label={r.label} tone={r.tone} count={r.names.length}>
          {r.names.map((n) => (
            <span key={n} className={chip}>
              {n}
            </span>
          ))}
        </Row>
      ))}
      {drift.versionChanged.length > 0 && (
        <Row label="updated" tone="text-info" count={drift.versionChanged.length}>
          {drift.versionChanged.map((v) => (
            <span key={v.name} className={`inline-flex items-center gap-1 ${chip}`}>
              {v.name}
              <span className="text-muted-foreground">{v.from ?? "—"}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-label="to" />
              <span className="text-foreground">{v.to ?? "—"}</span>
            </span>
          ))}
        </Row>
      )}
    </div>
  );
}
