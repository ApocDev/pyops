import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Plus, type LucideIcon } from "lucide-react";
import { SETTINGS_LINK, visibleNavLinks } from "./nav-links";
import { ProjectCreateDialog } from "./project-create-dialog";
import { rankMatches } from "../lib/command-search";
import { useHotkey } from "../lib/hotkeys";
import { Icon, IconProvider, type IconKind } from "../lib/icons";
import { dataCapabilitiesFn, listBlocksFn, saveBlockFn } from "../server/factorio";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** One row the palette can run. Search matches on `label`. */
type PaletteItem = {
  key: string;
  label: string;
  /** Lucide glyph (pages/actions) — game sprites pass `sprite` instead. */
  glyph?: LucideIcon;
  sprite?: { kind: IconKind; name: string };
  run: () => void | Promise<void>;
};

type PaletteGroup = { title: string; items: PaletteItem[] };

const GROUP_CAP = 10; // keep the panel scannable; type more to narrow

/**
 * The Ctrl+K / `/` command palette (#78): one search box over page navigation,
 * factory blocks, and a couple of actions. Arrow keys + Enter, Escape closes.
 *
 * Deliberately minimal for now — goods/recipes search (server-side), recent
 * selections on empty query, and smarter ranking/frecency are follow-ups; the
 * item model above is where they slot in.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  // Ctrl+K (Cmd+K on mac) toggles from anywhere, even while typing in a field;
  // `/` only opens when focus is outside text fields (the registry suppresses it
  // in inputs by default), so typing rates or chat messages is never interrupted.
  useHotkey("mod+k", () => setOpen((o) => !o), {
    description: "Open the command palette",
    allowInInputs: true,
  });
  useHotkey("/", () => setOpen(true), { description: "Open the command palette" });

  const caps = useQuery({ queryKey: ["dataCapabilities"], queryFn: () => dataCapabilitiesFn() });
  const blocks = useQuery({
    queryKey: ["blocks"],
    queryFn: () => listBlocksFn(),
    enabled: open,
  });

  const close = () => setOpen(false);
  // Reset the search whenever the palette closes, whatever closed it (Escape,
  // overlay click, Ctrl+K toggle, running an item) — it reopens fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const groups: PaletteGroup[] = useMemo(() => {
    const pages: PaletteItem[] = [...visibleNavLinks(caps.data), SETTINGS_LINK].map((l) => ({
      key: `page:${l.to}`,
      label: l.label,
      glyph: l.icon,
      run: () => void navigate({ to: l.to }),
    }));
    const blockItems: PaletteItem[] = (blocks.data ?? []).map((b) => ({
      key: `block:${b.id}`,
      label: b.name,
      sprite: b.iconName
        ? { kind: (b.iconKind ?? "item") as IconKind, name: b.iconName }
        : undefined,
      run: () => void navigate({ to: "/block/$id", params: { id: String(b.id) } }),
    }));
    const actions: PaletteItem[] = [
      {
        key: "action:new-block",
        label: "New block",
        glyph: Plus,
        run: async () => {
          const res = await saveBlockFn({
            data: { name: "New block", data: { goals: [], recipes: [] } },
          });
          void qc.invalidateQueries({ queryKey: ["blocks"] });
          void navigate({ to: "/block/$id", params: { id: String(res.id) } });
        },
      },
      {
        key: "action:new-project",
        label: "New project",
        glyph: Plus,
        run: () => setShowNewProject(true),
      },
    ];
    return [
      { title: "Pages", items: rankMatches(query, pages, (i) => i.label).slice(0, GROUP_CAP) },
      {
        title: "Blocks",
        items: rankMatches(query, blockItems, (i) => i.label).slice(0, GROUP_CAP),
      },
      { title: "Actions", items: rankMatches(query, actions, (i) => i.label).slice(0, GROUP_CAP) },
    ].filter((g) => g.items.length > 0);
  }, [caps.data, blocks.data, query, navigate, qc]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeItem = flat[Math.min(active, flat.length - 1)];

  // Clamp/reset the cursor when the result set changes shape under it.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeItem?.key ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeItem?.key]);

  const runItem = (item: PaletteItem) => {
    close();
    void item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && activeItem) {
      e.preventDefault();
      runItem(activeItem);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          // near the top at md+ so the result list can grow downward without
          // the panel jumping around the screen as matches change
          showClose={false}
          className="md:top-24 md:max-w-xl md:translate-y-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search pages, blocks, actions…"
              aria-label="Search commands"
            />
          </div>
          <div ref={listRef} className="max-h-96 min-h-0 flex-1 overflow-y-auto p-2">
            <IconProvider>
              {groups.map((g) => (
                <div key={g.title} className="mb-2 last:mb-0">
                  <div className="px-2 py-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    {g.title}
                  </div>
                  {g.items.map((item) => {
                    const isActive = item.key === activeItem?.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-key={item.key}
                        onClick={() => runItem(item)}
                        onMouseMove={() => setActive(flat.indexOf(item))}
                        className={`flex h-9 w-full items-center gap-2 px-2 text-left text-sm ${
                          isActive ? "bg-muted text-foreground" : "text-foreground/90"
                        }`}
                      >
                        {item.glyph ? (
                          <item.glyph className="size-4 shrink-0 text-muted-foreground" />
                        ) : item.sprite ? (
                          <Icon
                            kind={item.sprite.kind}
                            name={item.sprite.name}
                            size="sm"
                            noTitle
                            noHover
                          />
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {isActive && (
                          <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {open && blocks.isPending && (
                <div className="flex flex-col gap-1 px-2 py-1">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-2/3" />
                </div>
              )}
              {blocks.isError && (
                <div className="px-2 py-1 text-sm text-destructive">
                  Couldn't load blocks — page and action search still work.
                </div>
              )}
              {flat.length === 0 && !blocks.isPending && (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No matches for "{query}" — try a page name, block, or action.
                </div>
              )}
            </IconProvider>
          </div>
          <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            ↑↓ navigate · Enter open · Esc close
          </div>
        </DialogContent>
      </Dialog>
      {showNewProject && <ProjectCreateDialog onClose={() => setShowNewProject(false)} />}
    </>
  );
}
