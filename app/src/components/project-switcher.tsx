import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Database, X } from "lucide-react";
import {
  createProjectFn,
  listProjectsFn,
  removeProjectFn,
  setActiveProjectFn,
} from "../server/factorio";

type Projects = Awaited<ReturnType<typeof listProjectsFn>>;

/** Current project + dropdown to switch/create. Switching reloads the page —
 * every query in flight belongs to the previous project's database. */
export function ProjectSwitcher() {
  const [data, setData] = useState<Projects | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listProjectsFn().then(setData);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const active = data?.projects.find((p) => p.id === data.active);

  const switchTo = async (id: string) => {
    if (id === data?.active) return setOpen(false);
    setBusy(true);
    await setActiveProjectFn({ data: id });
    window.location.reload();
  };
  const create = async () => {
    const name = window
      .prompt("Project name? (each project is its own database — sync game data after creating)")
      ?.trim();
    if (!name) return;
    setBusy(true);
    await createProjectFn({ data: name });
    window.location.assign("/settings?tab=data"); // fresh db: first stop is the sync page
  };
  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Remove this project from the list? Its database file is kept on disk."))
      return;
    await removeProjectFn({ data: id });
    if (id === data?.active) window.location.reload();
    else setData(await listProjectsFn());
  };

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        title={`project: ${active?.name ?? "…"} — click to switch`}
      >
        <Database className="size-4" /> {active?.name ?? "…"}
        <ChevronDown className="size-3" />
      </button>
      {open && data && (
        <div className="absolute top-full right-0 z-50 min-w-48 border border-border bg-popover py-1 shadow-2xl">
          {data.projects.map((p) => (
            <button
              key={p.id}
              onClick={() => void switchTo(p.id)}
              className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted ${
                p.id === data.active ? "text-primary" : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === data.active && <Check className="size-4 shrink-0" />}
              {p.id !== "default" && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => void remove(p.id, e)}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  title="remove from list (db file kept)"
                >
                  <X className="size-3.5" />
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => void create()}
            className="w-full border-t border-border px-3 py-1.5 text-left text-sm text-sky-400 hover:bg-muted"
          >
            + new project…
          </button>
        </div>
      )}
    </div>
  );
}
