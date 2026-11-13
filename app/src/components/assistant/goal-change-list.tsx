import { Icon } from "#/lib/icons";
import { formatGoalValue, type GoalChangeDiff } from "#/lib/goals";

/** The goals a resize proposal changes, one line each: icon, name, old → new
 * (a rate, or a keep-in-stock amount). */
export function GoalChangeList({ changes }: { changes: GoalChangeDiff[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {changes.map((c) => (
        <li key={c.name} className="flex flex-wrap items-center gap-x-1.5">
          <Icon kind="item" name={c.name} size="sm" />
          <span>{c.display}</span>
          <span className="text-muted-foreground line-through">{formatGoalValue(c.before)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{formatGoalValue(c.after)}</span>
        </li>
      ))}
    </ul>
  );
}
