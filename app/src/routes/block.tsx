import { createFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  createGroupFn,
  deleteBlockFn,
  deleteBlockIfEmptyFn,
  deleteGroupFn,
  listBlocksFn,
  listGroupsFn,
  renameGroupFn,
  saveBlockFn,
  setBlockGroupFn,
  setBlockOrderFn,
  setGroupOrderFn,
} from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { Input } from "#/components/ui/input.tsx";

export const Route = createFileRoute("/block")({
  component: () => (
    <IconProvider>
      <Shell />
    </IconProvider>
  ),
});

const OPEN_KEY = "pyops.openBlocks";
const ACTIVE_KEY = "pyops.activeBlock"; // last block viewed — re-opened on return to /block
const COLLAPSE_KEY = "pyops.collapsedGroups";
type IconKind = "item" | "fluid" | "recipe";

// The active block's editor (the /block/$id Outlet) reports its live emptiness
// here so closing the tab can discard an untouched "New block" without racing the
// editor's unmount auto-save. Only the active block is mounted at a time.
export type ActiveEditorState = { id: number; empty: boolean };
export const ActiveEditorRefContext =
  createContext<MutableRefObject<ActiveEditorState | null> | null>(null);

/** Block workspace: a sidebar inventory of every block + tabs for the open ones,
 * with the active block's editor in the main pane (the /block/$id Outlet). */
function Shell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { id?: string };
  const activeId = params.id != null ? Number(params.id) : null;

  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => listGroupsFn() });
  const byId = new Map((blocks.data ?? []).map((b) => [b.id, b]));
  const [search, setSearch] = useState("");
  const [openTabs, setOpenTabs] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dragId = useRef<number | null>(null); // block being dragged in the sidebar
  const dragGroupId = useRef<number | null>(null); // folder being dragged in the sidebar
  const [dropBlock, setDropBlock] = useState<number | null>(null); // block we're hovering to insert before
  const [dropFolder, setDropFolder] = useState<string | null>(null); // folder hovered as a drop target
  const tabDragId = useRef<number | null>(null); // block id being dragged within the tab strip
  const [tabDragOver, setTabDragOver] = useState<number | null>(null);
  const tabsHydrated = useRef(false); // gate persistence until the saved tabs are restored
  const activeEditorRef = useRef<ActiveEditorState | null>(null); // live state of the open editor
  const refresh = () => void qc.invalidateQueries({ queryKey: ["blocks"] });
  const refreshGroups = () => void qc.invalidateQueries({ queryKey: ["groups"] });

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}");
      if (s && typeof s === "object") setCollapsed(s);
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const n = { ...c, [key]: !c[key] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(n));
      return n;
    });
  const moveToGroup = async (blockId: number, groupId: number | null) => {
    await setBlockGroupFn({ data: { blockId, groupId } });
    refresh();
  };
  // Drop block `a` just before block `target`, adopting target's folder. Reorders
  // within a folder and moves across folders at a precise position (vs. to-end).
  const dropBlockBefore = async (a: number, target: Row) => {
    if (a === target.id) return;
    const targetGroup = target.groupId ?? null;
    const order = (blocks.data ?? [])
      .filter((x) => (x.groupId ?? null) === targetGroup && x.id !== a)
      .map((x) => x.id);
    const at = order.indexOf(target.id);
    order.splice(at < 0 ? order.length : at, 0, a);
    if ((byId.get(a)?.groupId ?? null) !== targetGroup)
      await setBlockGroupFn({ data: { blockId: a, groupId: targetGroup } });
    await setBlockOrderFn({ data: order });
    refresh();
  };
  // Drop folder `a` just before folder `target` (or to the end when target is null).
  const dropFolderBefore = async (a: number, target: number | null) => {
    if (a === target) return;
    const order = (groups.data ?? []).map((g) => g.id).filter((id) => id !== a);
    const at = target == null ? order.length : order.indexOf(target);
    order.splice(at < 0 ? order.length : at, 0, a);
    await setGroupOrderFn({ data: order });
    refreshGroups();
  };
  const endDrag = () => {
    dragId.current = null;
    dragGroupId.current = null;
    setDropBlock(null);
    setDropFolder(null);
  };
  const newFolder = async () => {
    const name = window.prompt("Folder name?")?.trim();
    if (!name) return;
    await createGroupFn({ data: name });
    refreshGroups();
  };
  const renameFolder = async (id: number, current: string) => {
    const name = window.prompt("Rename folder", current)?.trim();
    if (!name) return;
    await renameGroupFn({ data: { id, name } });
    refreshGroups();
  };
  const deleteFolder = async (id: number) => {
    if (!window.confirm("Delete folder? Its blocks move to Ungrouped.")) return;
    await deleteGroupFn({ data: id });
    refreshGroups();
    refresh();
  };

  // open tabs are session UI state (which blocks you're actively working on)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]");
      if (Array.isArray(s)) setOpenTabs(s.filter((x) => typeof x === "number"));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    // Skip the mount-time write: on first render openTabs is still the initial []
    // (the load effect above hasn't applied yet). Persisting here would clobber the
    // saved list with [] before it's restored — which closed every tab on navigate-back.
    if (!tabsHydrated.current) {
      tabsHydrated.current = true;
      return;
    }
    localStorage.setItem(OPEN_KEY, JSON.stringify(openTabs));
  }, [openTabs]);
  useEffect(() => {
    if (activeId != null) {
      setOpenTabs((t) => (t.includes(activeId) ? t : [...t, activeId]));
      localStorage.setItem(ACTIVE_KEY, String(activeId));
    }
  }, [activeId]);
  // Landing on /block with no block selected (e.g. clicking "Blocks" from another
  // page): re-open the last block viewed, else the last open tab. Runs once per
  // mount. Reads localStorage directly to avoid racing the openTabs state restore.
  const autoNav = useRef(false);
  useEffect(() => {
    if (autoNav.current) return;
    if (activeId != null) {
      autoNav.current = true;
      return;
    }
    if (!blocks.data) return; // wait for the block list before deciding
    autoNav.current = true;
    const exists = (id: number) => blocks.data!.some((b) => b.id === id);
    let tabs: number[] = [];
    try {
      const s: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]");
      if (Array.isArray(s)) tabs = s.filter((x): x is number => typeof x === "number");
    } catch {
      /* ignore */
    }
    const saved = Number(localStorage.getItem(ACTIVE_KEY));
    const target = exists(saved) ? saved : tabs.filter(exists).at(-1);
    if (target != null) void navigate({ to: "/block/$id", params: { id: String(target) } });
  }, [activeId, blocks.data, navigate]);

  const open = (id: number) => void navigate({ to: "/block/$id", params: { id: String(id) } });
  const newBlock = async () => {
    const res = await saveBlockFn({
      data: { name: "New block", data: { goals: [], recipes: [] } },
    });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    open(res.id);
  };
  const closeTab = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((t) => {
      const next = t.filter((x) => x !== id);
      if (activeId === id) {
        const nb = next[next.length - 1];
        void navigate(
          nb != null ? { to: "/block/$id", params: { id: String(nb) } } : { to: "/block" },
        );
      }
      return next;
    });
    // Closing an untouched "New block" (no goal/recipes) discards it instead of
    // leaving an empty block behind. For the active tab we trust the editor's live
    // state (it may have unsaved edits the DB hasn't seen yet); for a background
    // tab — whose editor isn't mounted — the server re-checks the saved doc.
    const live = activeEditorRef.current;
    if (live?.id === id) {
      if (live.empty) void deleteBlockFn({ data: id }).then(refresh);
    } else {
      void deleteBlockIfEmptyFn({ data: id }).then((r) => {
        if (r.deleted) refresh();
      });
    }
  };
  // Reorder the tab strip: drop the dragged tab onto the position of another tab.
  const moveTab = (fromId: number, toId: number) => {
    if (fromId === toId) return;
    setOpenTabs((t) => {
      const from = t.indexOf(fromId);
      const to = t.indexOf(toId);
      if (from < 0 || to < 0) return t;
      const next = [...t];
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      return next;
    });
  };
  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this block permanently?")) return;
    await deleteBlockFn({ data: id });
    setOpenTabs((t) => t.filter((x) => x !== id));
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    if (activeId === id) void navigate({ to: "/block" });
  };

  const filtered = (blocks.data ?? []).filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );

  type Row = (typeof filtered)[number];
  const renderBlock = (b: Row) => (
    <div
      key={b.id}
      draggable
      onDragStart={() => {
        dragId.current = b.id;
      }}
      onDragOver={(e) => {
        if (dragId.current == null || dragId.current === b.id) return;
        e.preventDefault();
        e.stopPropagation(); // beat the folder's to-end drop handler
        if (dropBlock !== b.id) setDropBlock(b.id);
      }}
      onDrop={(e) => {
        if (dragId.current == null) return;
        e.preventDefault();
        e.stopPropagation();
        void dropBlockBefore(dragId.current, b);
        endDrag();
      }}
      onDragEnd={endDrag}
      className={`group ml-3 flex items-center gap-2 rounded px-2 py-1 hover:bg-muted ${activeId === b.id ? "bg-accent" : ""} ${dropBlock === b.id ? "border-t-2 border-primary" : "border-t-2 border-transparent"}`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => open(b.id)}
      >
        {b.iconName && (
          <Icon kind={(b.iconKind ?? "item") as IconKind} name={b.iconName} size="sm" noTitle />
        )}
        <span className="truncate text-sm">{b.name}</span>
        {b.broken && (
          <span
            className="shrink-0 text-destructive"
            title="references a recipe/good that no longer exists — open to see what's missing"
          >
            ⚠
          </span>
        )}
      </button>
      <button
        className="px-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        title="delete"
        onClick={(e) => del(b.id, e)}
      >
        ✕
      </button>
    </div>
  );
  const renderFolder = (
    key: string,
    title: string,
    gid: number | null,
    rows: Row[],
    opts?: { onDelete: () => void; onRename: () => void },
  ) => {
    const isCol = collapsed[key];
    return (
      <div
        key={key}
        onDragOver={(e) => {
          // folder-to-end / folder-reorder target; block reorder is handled per-row
          if (dragId.current == null && dragGroupId.current == null) return;
          e.preventDefault();
          if (dropFolder !== key) setDropFolder(key);
        }}
        onDrop={() => {
          if (dragGroupId.current != null) void dropFolderBefore(dragGroupId.current, gid);
          else if (dragId.current != null) void moveToGroup(dragId.current, gid);
          endDrag();
        }}
      >
        <div
          draggable={gid != null}
          onDragStart={(e) => {
            if (gid == null) return;
            e.stopPropagation();
            dragGroupId.current = gid;
          }}
          className={`group flex items-center gap-1 rounded px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-muted/50 ${dropFolder === key ? "bg-primary/15" : ""}`}
        >
          <button className="w-4 shrink-0" onClick={() => toggle(key)}>
            {isCol ? "▸" : "▾"}
          </button>
          <span className="min-w-0 flex-1 truncate" onDoubleClick={opts?.onRename}>
            {title} ({rows.length})
          </span>
          {opts && (
            <button
              className="px-1 opacity-0 group-hover:opacity-100 hover:text-destructive"
              title="delete folder"
              onClick={opts.onDelete}
            >
              ✕
            </button>
          )}
        </div>
        {!isCol && rows.map(renderBlock)}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-background font-mono text-foreground">
      {/* Sidebar — the full block inventory */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-2 py-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Blocks ({blocks.data?.length ?? 0})
          </span>
          <button
            onClick={newFolder}
            title="new folder"
            className="ml-auto rounded border border-border px-1.5 text-sm hover:bg-muted"
          >
            🗀
          </button>
          <button
            onClick={newBlock}
            title="new block"
            className="rounded bg-primary px-2 font-bold text-primary-foreground hover:bg-primary/80"
          >
            ＋
          </button>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search blocks…"
          className="m-2 w-auto"
        />
        <div className="flex-1 overflow-auto px-1 pb-2">
          {(blocks.data?.length ?? 0) === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              no blocks yet — ＋ to add one
            </div>
          ) : (
            <>
              {groups.data?.map((g) =>
                renderFolder(
                  `g${g.id}`,
                  g.name,
                  g.id,
                  filtered.filter((b) => b.groupId === g.id),
                  {
                    onDelete: () => deleteFolder(g.id),
                    onRename: () => renameFolder(g.id, g.name),
                  },
                ),
              )}
              {renderFolder(
                "ungrouped",
                "Ungrouped",
                null,
                filtered.filter((b) => b.groupId == null),
              )}
              {filtered.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">no matches</div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main — open-block tabs + the active editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-stretch gap-px overflow-x-auto border-b border-border bg-card"
          // middle-click the empty strip = new block (browser-style)
          onAuxClick={(e) => {
            if (e.button === 1 && e.target === e.currentTarget) void newBlock();
          }}
          onMouseDown={(e) => {
            if (e.button === 1 && e.target === e.currentTarget) e.preventDefault();
          }}
        >
          {openTabs.map((id) => {
            const b = byId.get(id);
            const active = activeId === id;
            return (
              <button
                key={id}
                draggable
                onClick={() => open(id)}
                // middle-click a tab = close it; suppress the autoscroll cursor
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(id, e);
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
                onDragStart={() => {
                  tabDragId.current = id;
                }}
                onDragOver={(e) => {
                  if (tabDragId.current == null) return;
                  e.preventDefault();
                  if (tabDragOver !== id) setTabDragOver(id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (tabDragId.current != null) moveTab(tabDragId.current, id);
                  tabDragId.current = null;
                  setTabDragOver(null);
                }}
                onDragEnd={() => {
                  tabDragId.current = null;
                  setTabDragOver(null);
                }}
                className={`flex shrink-0 items-center gap-1.5 border-t-2 px-3 py-1.5 text-sm ${active ? "border-primary bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-muted"} ${tabDragOver === id ? "bg-primary/15" : ""}`}
              >
                {b?.iconName && (
                  <Icon
                    kind={(b.iconKind ?? "item") as IconKind}
                    name={b.iconName}
                    size="sm"
                    noTitle
                  />
                )}
                <span className="max-w-[10rem] truncate">{b?.name ?? `#${id}`}</span>
                {b?.broken && (
                  <span className="text-destructive" title="references missing prototypes">
                    ⚠
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => closeTab(id, e)}
                  className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            onClick={() => void newBlock()}
            title="new block (or middle-click the empty tab strip)"
            className="shrink-0 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ＋
          </button>
          {openTabs.length === 0 && (
            <div className="px-3 py-1.5 text-sm text-muted-foreground">no open blocks</div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ActiveEditorRefContext.Provider value={activeEditorRef}>
            <Outlet />
          </ActiveEditorRefContext.Provider>
        </div>
      </div>
    </div>
  );
}
