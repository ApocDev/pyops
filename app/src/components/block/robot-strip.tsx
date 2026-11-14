import { useState } from "react";
import { useStore } from "@tanstack/react-store";
import { X } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Icon } from "../../lib/icons";
import { robotsForRate } from "../../lib/robots";
import { RobotDistanceInput } from "../robot-distance-input.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";

/** The block's robot total and its trip-distance override (#255), as a strip at
 * the top of the Balance card. The total covers every item crossing the block
 * boundary: imports, surplus exports, and produced goals. */
export function RobotStrip({
  doc,
  res,
  logi,
  kindOf,
}: {
  doc: BlockDocStore;
  res: SolveResult;
  logi: LogiView;
  kindOf: (name: string) => "item" | "fluid";
}) {
  const override = useStore(doc.store, (s) => s.robotDistance);
  const goals = useStore(doc.store, (s) => s.goals);
  const [editing, setEditing] = useState(false);
  const robots = logi.robots;
  if (!robots) return null;

  const item = (f: { name: string; kind: string }) =>
    f.kind === "item" && !f.name.startsWith("pyops-");
  const rates = [
    ...res.imports.filter(item).map((f) => f.rate),
    ...res.displayExports.filter(item).map((f) => f.rate),
    ...goals.filter((g) => g.rate > 0 && kindOf(g.name) === "item").map((g) => g.rate),
  ];
  if (!rates.length) return null;
  const { robot, roboport, bonuses } = robots.resolved;
  const total = rates.reduce(
    (sum, rate) => sum + robotsForRate(rate, robot, bonuses, robots.distance, roboport),
    0,
  );
  const whole = Number.isFinite(total) ? Math.ceil(total - 1e-9) : Infinity;

  const setDistance = (tiles: number | null) => {
    doc.setRobotDistance(tiles);
    doc.note(
      tiles == null ? "Use the default robot trip distance" : `Set robot trip distance to ${tiles}`,
    );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-muted/45 px-3 py-1.5 text-sm"
      data-robot-strip
    >
      <Tooltip
        content={`${robot.display ?? robot.name} moving every item in and out over ${robots.distance} tiles${roboport ? `, charging at ${roboport.display ?? roboport.name}` : ""}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon kind="entity" name={robot.name} size="sm" noHover />
          <b className="font-semibold tabular-nums" data-robot-total>
            {Number.isFinite(whole) ? whole : "∞"}
          </b>
          {whole === 1 ? "robot" : "robots"}
        </span>
      </Tooltip>
      {override != null || editing ? (
        <span className="inline-flex items-center gap-1.5">
          <RobotDistanceInput
            label="Block robot trip distance"
            value={override ?? logi.defaultRobotDistance}
            onCommit={setDistance}
            onDone={() => setEditing(false)}
            autoFocus={editing && override == null}
            className={override != null ? "h-7 border-info/60" : "h-7"}
          />
          {override != null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDistance(null)}
              title={`Use the factory default (${logi.defaultRobotDistance} tiles)`}
            >
              <X />
              Default
            </Button>
          )}
        </span>
      ) : (
        <>
          <span className="text-muted-foreground">· {robots.distance} tiles</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            Set distance
          </Button>
        </>
      )}
    </div>
  );
}
