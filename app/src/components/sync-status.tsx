import { Check, History } from "lucide-react";
import type { ReactNode } from "react";
import { timeAgo } from "../lib/format";
import { useGameLinked } from "../lib/use-game-linked";

/** Status line for data pushed from the game: "Live" only while the bridge is
 * connected; otherwise "Last synced 3 days ago" in warning color, so an old
 * snapshot never reads as current. `children` follow the label (counts etc.). */
export function SyncStatus({
  syncedAt,
  children,
  className = "",
}: {
  syncedAt: string;
  children?: ReactNode;
  className?: string;
}) {
  const linked = useGameLinked();
  return linked ? (
    <span className={`inline-flex items-center gap-1 text-sm text-success ${className}`}>
      <Check className="size-3.5 shrink-0" /> Live{children}
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 text-sm text-warning ${className}`}>
      <History className="size-3.5 shrink-0" /> Last synced {timeAgo(syncedAt)}
      {children}
    </span>
  );
}
