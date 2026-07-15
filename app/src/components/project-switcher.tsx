import { useEffect, useState } from "react";
import { Check, ChevronDown, Database, X } from "lucide-react";
import { listProjectsFn, removeProjectFn, setActiveProjectFn } from "../server/factorio";
import { toast } from "../lib/toast-store";
import { ProjectCreateDialog } from "./project-create-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";

type Projects = Awaited<ReturnType<typeof listProjectsFn>>;

/** Current project + dropdown to switch/create. Switching reloads the page —
 * every query in flight belongs to the previous project's database. */
export function ProjectSwitcher() {
  const [data, setData] = useState<Projects | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  // project awaiting remove confirmation — drives the ConfirmDialog. Removal is
  // file-level (not in the undo log), so it gets a real confirm and its toast
  // has no Undo button (#83).
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void listProjectsFn().then(setData);
  }, []);

  const active = data?.projects.find((p) => p.id === data.active);

  const switchTo = async (id: string) => {
    if (id === data?.active) return;
    setBusy(true);
    await setActiveProjectFn({ data: id });
    // Full reload on purpose (#84). The server doesn't force this: the shared
    // `db` proxy repoints in-process the moment setActiveProjectFn runs
    // (src/db/index.server.ts, src/server/projects.server.ts), so the next
    // server-fn call already reads the new project's database. The client is
    // what can't switch softly — per-project data lives not only in react-query
    // caches (invalidatable) but also in module-level caches (the icon manifest
    // and spoilables in lib/icons.tsx are fetched once per page load) and in
    // useEffect-owned local state across pages (block, assistant, tasks). A
    // router.navigate + invalidateQueries would leave those surfaces showing —
    // or writing edits against — the previous project's data. A reload is the
    // one flush that covers all three.
    window.location.reload();
  };
  const remove = async (p: { id: string; name: string }) => {
    setRemoving(null);
    await removeProjectFn({ data: p.id });
    // removing the active project switches back to default — reload for the
    // same reasons as switchTo (the toast wouldn't survive it anyway)
    if (p.id === data?.active) {
      window.location.reload();
      return;
    }
    toast({ message: `Removed project "${p.name}" — its database file is kept on disk` });
    setData(await listProjectsFn());
  };

  return (
    <div className="flex items-stretch">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            disabled={busy}
            className="h-full gap-1.5 px-3 font-normal text-muted-foreground hover:bg-muted/50"
            title={`Project: ${active?.name ?? "…"} — click to switch`}
          >
            <Database className="size-4" /> {active?.name ?? "…"}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {data?.projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => void switchTo(p.id)}
              className={`group ${
                p.id === data.active
                  ? "text-primary focus:text-primary data-highlighted:text-primary"
                  : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === data.active && <Check className="size-4 shrink-0" />}
              {p.id !== "default" && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation(); // keep the row's select from firing
                    setRemoving({ id: p.id, name: p.name });
                  }}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  title="Remove from list (db file kept)"
                >
                  <X className="size-3.5" />
                </span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setCreating(true)}
            className="text-info focus:text-info data-highlighted:text-info"
          >
            + New project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={removing != null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove project"
        description={
          removing
            ? `Remove "${removing.name}" from the project list? This can't be undone from the app. Nothing is deleted — its database file is kept on disk, moved into the projects/_removed folder.`
            : ""
        }
        confirmLabel="Remove project"
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
      {creating && <ProjectCreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
