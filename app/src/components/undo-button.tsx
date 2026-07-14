import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";

import { runUndo } from "../lib/undo-client";
import { undoStatusSubscription } from "../lib/live-query-options";
import { Button } from "#/components/ui/button.tsx";

/** The nav undo affordance (#90): an unobtrusive icon button whose tooltip
 * names what the next Ctrl+Z will revert ("Undo: Edit block …"), disabled when
 * the stack is empty. Clicking it runs the same path as Ctrl+Z. The app-shell
 * query owner keeps the label fresh between immediate mutation invalidations. */
export function UndoButton() {
  const qc = useQueryClient();
  const status = useQuery(undoStatusSubscription);
  const undo = useMutation({ mutationFn: () => runUndo(qc) });
  const top = status.data?.top ?? null;
  const empty = (status.data?.depth ?? 0) === 0;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => undo.mutate()}
      disabled={empty || undo.isPending}
      title={top ? `Undo: ${top.name}` : "Nothing to undo"}
      aria-label={top ? `Undo: ${top.name}` : "Nothing to undo"}
      className="h-full text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      <Undo2 className="size-4" />
    </Button>
  );
}
