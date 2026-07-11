import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Icon } from "#/lib/icons.tsx";
import { rateLabel } from "#/lib/format.ts";

export type SupplyAllocation = {
  blockId: number;
  blockName: string;
  good: string;
  display: string;
  kind: string;
  priority: number;
  incidental: boolean;
  rate: number;
};

const priorityIcon = (priority: number) =>
  priority > 0
    ? { Icon: ArrowUp, className: "text-success", label: `priority ${priority}` }
    : priority < 0
      ? { Icon: ArrowDown, className: "text-warning", label: `priority ${priority}` }
      : { Icon: Minus, className: "text-muted-foreground", label: "normal priority" };

export function SupplyAllocationCard({ rows }: { rows: SupplyAllocation[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="normal-case">Supply allocation</CardTitle>
      </CardHeader>
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const priority = priorityIcon(row.priority);
          return (
            <div
              key={`${row.blockId}-${row.good}`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <Icon
                kind={row.kind as "item" | "fluid"}
                name={row.good}
                size="sm"
                title={row.display}
              />
              <span className="min-w-0 flex-1 truncate">{row.display}</span>
              <priority.Icon
                className={`size-4 shrink-0 ${priority.className}`}
                aria-label={priority.label}
              />
              {row.incidental && <span className="text-surplus">recovered</span>}
              <Link
                to="/block/$id"
                params={{ id: String(row.blockId) }}
                className="max-w-48 truncate text-primary underline"
              >
                {row.blockName}
              </Link>
              <span className="w-24 text-right tabular-nums">
                {rateLabel(row.good, row.rate)}/s
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
