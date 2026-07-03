import { useState } from "react";
import { createProjectFn } from "../server/factorio";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";

/** New-project dialog: a name field plus a one-line explanation of what a
 * project is. Enter submits (it's a form), Escape cancels (radix), and the
 * create button stays disabled while the name is empty. */
export function ProjectCreateDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createProjectFn({ data: trimmed });
      // Creating also switches to the new project, so this is a full navigation
      // on purpose — see the note in ProjectSwitcher for why a project switch
      // can't be a soft router transition. First stop for a fresh db: the sync page.
      window.location.assign("/settings?tab=data");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
          <div className="flex flex-col gap-3 p-3">
            <DialogDescription>
              Each project is its own database — a separate factory plan, usually for a different
              mod list. It starts empty: sync game data after creating it.
            </DialogDescription>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-project-name">Name</Label>
              <Input
                id="new-project-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Py hard mode"
                disabled={busy}
              />
            </div>
            {error && <Callout tone="destructive">{error}</Callout>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
