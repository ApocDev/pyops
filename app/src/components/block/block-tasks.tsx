import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { tasksForBlockFn } from "../../server/tasks.ts";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { head } from "./styles.ts";

/** Reverse view of task→block links: the planner tasks that reference this
 * block, each linking back to it on the tasks page. Hidden when none. */
export function BlockTasks({ blockId }: { blockId: number }) {
  const tasks = useQuery({
    queryKey: ["tasks-for-block", blockId],
    queryFn: () => tasksForBlockFn({ data: blockId }),
  });
  const list = tasks.data ?? [];
  if (list.length === 0) return null;
  return (
    <Card className="mb-4">
      <div className={head}>Tasks ({list.length})</div>
      <CardContent className="space-y-0.5 py-2">
        {list.map((t) => {
          const total = t.stepTotal + t.childTotal;
          const done = t.stepDone + t.childDone;
          return (
            <Link
              key={t.id}
              to="/tasks"
              search={{ tab: "tasks", t: t.id }}
              className="flex items-center gap-2 px-1 py-0.5 text-sm hover:bg-muted"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${t.done ? "bg-success" : "bg-muted-foreground/40"}`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${t.done ? "text-muted-foreground line-through" : ""}`}
              >
                {t.title || "Untitled task"}
              </span>
              {total > 0 && (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {done}/{total}
                </span>
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
