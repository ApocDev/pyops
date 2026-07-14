import { ClipboardPaste, Copy } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { parseGoalsClipboard, serializeGoalsClipboard } from "#/lib/goal-clipboard.ts";
import { toast } from "#/lib/toast-store.ts";
import type { Goal } from "../../db/schema.ts";

/** Copy/paste controls for transferring goal intent without any recipe or block
 * configuration. The caller owns the append operation so it remains a normal
 * doc-store edit with the editor's existing save and undo behavior. */
export function GoalClipboardActions({
  goals,
  onPaste,
}: {
  goals: readonly Goal[];
  onPaste: (goals: readonly Goal[]) => { added: number; skipped: number };
}) {
  const copyGoals = async () => {
    if (!navigator.clipboard?.writeText) {
      toast({ message: "Clipboard access is unavailable.", tone: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(serializeGoalsClipboard(goals));
      toast({
        message: `Copied ${goals.length} goal${goals.length === 1 ? "" : "s"}.`,
        tone: "success",
      });
    } catch {
      toast({ message: "Could not copy goals to the clipboard.", tone: "destructive" });
    }
  };
  const pasteGoals = async () => {
    if (!navigator.clipboard?.readText) {
      toast({ message: "Clipboard access is unavailable.", tone: "destructive" });
      return;
    }
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast({ message: "Could not read goals from the clipboard.", tone: "destructive" });
      return;
    }
    const copied = parseGoalsClipboard(text);
    if (!copied) {
      toast({ message: "Clipboard does not contain PyOps goals.", tone: "destructive" });
      return;
    }
    if (!copied.length) {
      toast({ message: "The copied goal list is empty." });
      return;
    }
    const { added, skipped } = onPaste(copied);
    if (!added) {
      toast({ message: `No goals pasted — ${skipped} already present.` });
      return;
    }
    toast({
      message: `Pasted ${added} goal${added === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} already present` : ""}.`,
      tone: "success",
    });
  };

  return (
    <>
      <Tooltip content="Copy all goals — includes rates, stock targets, refill windows, and order">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy goals"
          disabled={!goals.length}
          onClick={() => void copyGoals()}
          className="text-muted-foreground"
        >
          <Copy className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Paste goals — append copied goals without changing existing goals or recipes">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Paste goals"
          onClick={() => void pasteGoals()}
          className="text-muted-foreground"
        >
          <ClipboardPaste className="size-4" />
        </Button>
      </Tooltip>
    </>
  );
}
