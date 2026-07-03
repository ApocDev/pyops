import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Keyboard, Plus, Undo2, type LucideIcon } from "lucide-react";
import { SETTINGS_LINK, visibleNavLinks } from "./nav-links";
import { ProjectCreateDialog } from "./project-create-dialog";
import { openShortcutHelp } from "./shortcut-help-sheet";
import { rankMatches } from "../lib/command-search";
import { useHotkey } from "../lib/hotkeys";
import { loadRecents } from "../lib/recents";
import { runUndo } from "../lib/undo-client";
import { Icon, IconProvider, type IconKind } from "../lib/icons";
import { dataCapabilitiesFn, listBlocksFn, saveBlockFn, searchAllFn } from "../server/factorio";
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
const RECENT_CAP = 6; // recents are a shortcut, not a history browser

/** Debounce a fast-changing value (the goods search hits SQLite per keystroke
 * otherwise). Tiny and palette-only, so it lives here rather than in lib/. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * The Ctrl+K / `/` command palette (#78): one search box over page navigation,
 * factory blocks, goods (items + fluids, searched server-side against SQLite),
 * and a few actions. Empty query surfaces recently visited blocks/goods.
 * Arrow keys + Enter, Escape closes.
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

  // Goods search runs server-side (Py ships thousands of items; the client
  // never sees the full table). Debounced so SQLite isn't hit per keystroke;
  // keepPreviousData holds the last results steady while the next ones load.
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 150);
  const goods = useQuery({
    queryKey: ["paletteGoods", debounced],
    queryFn: () => searchAllFn({ data: debounced }),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
  });
  // Between a keystroke and its (debounced) results, goods are in flux — used
  // to hold off the "no matches" verdict so it never flashes mid-search.
  const goodsSettling = trimmed.length > 0 && (debounced !== trimmed || goods.isFetching);

  // Recently visited blocks/goods (lib/recents.ts) — read when the palette
  // opens, so visits recorded on other pages since the last open are included.
  const recents = useMemo(() => (open ? loadRecents() : []), [open]);

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
    const blockItem = (
      b: NonNullable<typeof blocks.data>[number],
      keyPrefix = "",
    ): PaletteItem => ({
      key: `${keyPrefix}block:${b.id}`,
      label: b.name,
      sprite: b.iconName
        ? { kind: (b.iconKind ?? "item") as IconKind, name: b.iconName }
        : undefined,
      run: () => void navigate({ to: "/block/$id", params: { id: String(b.id) } }),
    });
    // Recent selections show only on an empty query (typing means the user
    // already knows what they want). Blocks resolve against the live block
    // list — renames show fresh, deleted blocks drop out.
    const recentItems: PaletteItem[] = trimmed
      ? []
      : recents
          .flatMap((r): PaletteItem[] => {
            if (r.type === "block") {
              const b = (blocks.data ?? []).find((x) => x.id === r.id);
              return b ? [blockItem(b, "recent:")] : [];
            }
            return [
              {
                key: `recent:good:${r.name}`,
                label: r.display || r.name,
                sprite: { kind: r.goodKind, name: r.name },
                run: () => void navigate({ to: "/browse", search: { sel: r.name } }),
              },
            ];
          })
          .slice(0, RECENT_CAP);
    const recentKeys = new Set(recentItems.map((i) => i.key.replace(/^recent:/, "")));
    const blockItems: PaletteItem[] = (blocks.data ?? [])
      .map((b) => blockItem(b))
      // on an empty query, don't repeat what the Recent group already shows
      .filter((b) => trimmed.length > 0 || !recentKeys.has(b.key));
    // Goods arrive pre-filtered and pre-ranked by the server (its match covers
    // internal names too, which the visible label deliberately isn't).
    const goodItems: PaletteItem[] = trimmed
      ? (goods.data ?? []).map((g) => ({
          key: `good:${g.kind}:${g.name}`,
          label: g.display ?? g.name,
          sprite: { kind: g.kind as IconKind, name: g.name },
          run: () => void navigate({ to: "/browse", search: { sel: g.name } }),
        }))
      : [];
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
      {
        key: "action:undo",
        label: "Undo last action",
        glyph: Undo2,
        run: () => runUndo(qc), // same path as Ctrl+Z / the nav button
      },
      {
        key: "action:shortcuts",
        label: "Keyboard shortcuts",
        glyph: Keyboard,
        run: () => openShortcutHelp(), // also on `?` outside text fields
      },
    ];
    return [
      { title: "Recent", items: recentItems },
      { title: "Pages", items: rankMatches(query, pages, (i) => i.label).slice(0, GROUP_CAP) },
      {
        title: "Blocks",
        items: rankMatches(query, blockItems, (i) => i.label).slice(0, GROUP_CAP),
      },
      { title: "Goods", items: goodItems.slice(0, GROUP_CAP) },
      { title: "Actions", items: rankMatches(query, actions, (i) => i.label).slice(0, GROUP_CAP) },
    ].filter((g) => g.items.length > 0);
  }, [caps.data, blocks.data, goods.data, recents, query, trimmed, navigate, qc]);

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
              placeholder="Search pages, blocks, goods, actions…"
              aria-label="Search commands"
            />
          </div>
          <div ref={listRef} className="max-h-96 min-h-0 flex-1 overflow-y-auto p-2">
            <IconProvider>
              {groups.map((g) => (
                // data-group: a stable per-group handle (a block and a good can
                // share a visible name; tests and tools scope by group with it)
                <div key={g.title} data-group={g.title} className="mb-2 last:mb-0">
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
              {open && (blocks.isPending || (trimmed.length > 0 && goods.isPending)) && (
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
              {goods.isError && (
                <div className="px-2 py-1 text-sm text-destructive">
                  Couldn't search goods — pages, blocks, and actions still work.
                </div>
              )}
              {flat.length === 0 && !blocks.isPending && !goodsSettling && (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No matches for "{query}" — try a page, block, good, or action.
                </div>
              )}
            </IconProvider>
          </div>
          <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            ↑↓ navigate · Enter open · Esc close · ? shortcuts
          </div>
        </DialogContent>
      </Dialog>
      {showNewProject && <ProjectCreateDialog onClose={() => setShowNewProject(false)} />}
    </>
  );
}
