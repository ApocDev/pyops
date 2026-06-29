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
  setGroupParentFn,
} from "../server/factorio";
import { AlertTriangle, ChevronDown, ChevronRight, FolderPlus, Plus, X } from "lucide-react";
import { Icon, IconProvider } from "../lib/icons";
import { Input } from "#/components/ui/input.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";

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
  // block we're hovering over, and whether we'd drop after it (bottom half) — drives
  // the insertion line so you can see exactly where the block lands
  const [dropBlock, setDropBlock] = useState<{ id: number; after: boolean } | null>(null);
  // folder hovered as a drop target; `into` = nest inside it (ring), else reorder
  // before it (insertion line). Block drags always nest (`into`).
  const [dropFolder, setDropFolder] = useState<{ key: string; into: boolean } | null>(null);
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
  // Drop block `a` just before (or after) block `target`, adopting target's folder.
  // Reorders within a folder and moves across folders at a precise position.
  const dropBlockAt = async (a: number, target: Row, after: boolean) => {
    if (a === target.id) return;
    const targetGroup = target.groupId ?? null;
    const order = (blocks.data ?? [])
      .filter((x) => (x.groupId ?? null) === targetGroup && x.id !== a)
      .map((x) => x.id);
    let at = order.indexOf(target.id);
    if (at < 0) at = order.length;
    else if (after) at += 1;
    order.splice(at, 0, a);
    if ((byId.get(a)?.groupId ?? null) !== targetGroup)
      await setBlockGroupFn({ data: { blockId: a, groupId: targetGroup } });
    await setBlockOrderFn({ data: order });
    refresh();
  };
  const childrenOf = (parent: number | null) =>
    (groups.data ?? []).filter((g) => (g.parentId ?? null) === parent);
  // Reorder folder `a` just before sibling `target`, adopting target's parent.
  const dropFolderBefore = async (a: number, target: Group) => {
    if (a === target.id) return;
    const parent = target.parentId ?? null;
    if (((groups.data ?? []).find((g) => g.id === a)?.parentId ?? null) !== parent) {
      const r = await setGroupParentFn({ data: { id: a, parentId: parent } });
      if (!r.ok) return; // would form a cycle — leave it where it was
    }
    const order = childrenOf(parent)
      .filter((g) => g.id !== a)
      .map((g) => g.id);
    const at = order.indexOf(target.id);
    order.splice(at < 0 ? order.length : at, 0, a);
    await setGroupOrderFn({ data: order });
    refreshGroups();
    refresh();
  };
  // Nest folder `a` inside folder `parentId` (null = top level).
  const moveGroup = async (a: number, parentId: number | null) => {
    await setGroupParentFn({ data: { id: a, parentId } });
    refreshGroups();
    refresh();
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
    if (!window.confirm("Delete folder? Its blocks and subfolders move up to its parent.")) return;
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
  type Group = NonNullable<typeof groups.data>[number];
  const renderBlock = (b: Row, depth: number) => (
    <div
      key={b.id}
      draggable
      style={{ marginLeft: 8 + depth * 12 }}
      onDragStart={() => {
        dragId.current = b.id;
      }}
      onDragOver={(e) => {
        if (dragId.current == null || dragId.current === b.id) return;
        e.preventDefault();
        e.stopPropagation(); // beat the folder's to-end drop handler
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        if (dropBlock?.id !== b.id || dropBlock.after !== after) setDropBlock({ id: b.id, after });
      }}
      onDrop={(e) => {
        if (dragId.current == null) return;
        e.preventDefault();
        e.stopPropagation();
        void dropBlockAt(dragId.current, b, dropBlock?.id === b.id ? dropBlock.after : false);
        endDrag();
      }}
      onDragEnd={endDrag}
      className={`group relative flex items-center gap-2 rounded px-2 py-1 hover:bg-muted ${activeId === b.id ? "bg-accent" : ""}`}
    >
      {dropBlock?.id === b.id && (
        <div
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary ${dropBlock.after ? "-bottom-px" : "-top-px"}`}
        />
      )}
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
            <AlertTriangle className="size-3.5" />
          </span>
        )}
      </button>
      <button
        className="px-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        title="delete"
        onClick={(e) => del(b.id, e)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
  // A real folder, rendered recursively: its subfolders (nested) then its blocks.
  // Dropping a folder on the top sliver reorders it before this one; lower down nests
  // it inside. Dropping a block always nests it here.
  const renderFolder = (group: Group, depth: number) => {
    const key = `g${group.id}`;
    const isCol = collapsed[key];
    const rows = filtered.filter((b) => b.groupId === group.id);
    const kids = childrenOf(group.id);
    const showInto = dropFolder?.key === key && dropFolder.into;
    const showLine = dropFolder?.key === key && !dropFolder.into;
    return (
      <div key={key}>
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            dragGroupId.current = group.id;
          }}
          onDragOver={(e) => {
            if (dragId.current == null && dragGroupId.current == null) return;
            e.preventDefault();
            // a dragged folder reorders (top sliver) or nests (rest); a block nests
            let into = true;
            if (dragGroupId.current != null) {
              const r = e.currentTarget.getBoundingClientRect();
              into = e.clientY > r.top + r.height * 0.4;
            }
            setDropFolder((d) => (d?.key === key && d.into === into ? d : { key, into }));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const into = dropFolder?.key === key ? dropFolder.into : true;
            if (dragGroupId.current != null) {
              if (into) void moveGroup(dragGroupId.current, group.id);
              else void dropFolderBefore(dragGroupId.current, group);
            } else if (dragId.current != null) void moveToGroup(dragId.current, group.id);
            endDrag();
          }}
          onDragEnd={endDrag}
          style={{ marginLeft: depth * 12 }}
          className={`group relative flex items-center gap-1 rounded px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-muted/50 ${showInto ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
        >
          {showLine && (
            <div className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-primary" />
          )}
          <button className="flex w-4 shrink-0 justify-center" onClick={() => toggle(key)}>
            {isCol ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span
            className="min-w-0 flex-1 truncate"
            onDoubleClick={() => renameFolder(group.id, group.name)}
          >
            {group.name} ({rows.length})
          </span>
          <button
            className="px-1 opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="delete folder"
            onClick={() => deleteFolder(group.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
        {!isCol && (
          <>
            {kids.map((k) => renderFolder(k, depth + 1))}
            {rows.map((b) => renderBlock(b, depth + 1))}
          </>
        )}
      </div>
    );
  };
  // The "Ungrouped" pseudo-folder (top-level, groupId null). Dropping a folder here
  // moves it back to the top level; dropping a block un-groups it.
  const renderUngrouped = () => {
    const key = "ungrouped";
    const isCol = collapsed[key];
    const rows = filtered.filter((b) => b.groupId == null);
    const showInto = dropFolder?.key === key;
    return (
      <div key={key}>
        <div
          onDragOver={(e) => {
            if (dragId.current == null && dragGroupId.current == null) return;
            e.preventDefault();
            setDropFolder((d) => (d?.key === key ? d : { key, into: true }));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragGroupId.current != null) void moveGroup(dragGroupId.current, null);
            else if (dragId.current != null) void moveToGroup(dragId.current, null);
            endDrag();
          }}
          onDragEnd={endDrag}
          className={`group flex items-center gap-1 rounded px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-muted/50 ${showInto ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
        >
          <button className="flex w-4 shrink-0 justify-center" onClick={() => toggle(key)}>
            {isCol ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span className="min-w-0 flex-1 truncate">Ungrouped ({rows.length})</span>
        </div>
        {!isCol && rows.map((b) => renderBlock(b, 0))}
      </div>
    );
  };

  return (
    <SidebarShell
      className="bg-background font-mono text-foreground"
      width="w-64"
      label="Blocks"
      sidebar={
        <>
          <div className="flex items-center gap-2 border-b border-border px-2 py-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Blocks ({blocks.data?.length ?? 0})
            </span>
            <button
              onClick={newFolder}
              title="new folder"
              className="ml-auto flex items-center rounded border border-border px-1.5 py-1 hover:bg-muted"
            >
              <FolderPlus className="size-4" />
            </button>
            <button
              onClick={newBlock}
              title="new block"
              className="flex items-center rounded bg-primary px-1.5 py-1 text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="size-4" />
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
              <div className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground">
                no blocks yet — <Plus className="inline size-3" /> to add one
              </div>
            ) : (
              <>
                {childrenOf(null).map((g) => renderFolder(g, 0))}
                {renderUngrouped()}
                {filtered.length === 0 && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">no matches</div>
                )}
              </>
            )}
          </div>
        </>
      }
    >
      {/* Main — open-block tabs + the active editor */}
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
                  <AlertTriangle className="size-3.5" />
                </span>
              )}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => closeTab(id, e)}
                className="flex items-center rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </span>
            </button>
          );
        })}
        <button
          onClick={() => void newBlock()}
          title="new block (or middle-click the empty tab strip)"
          className="flex shrink-0 items-center px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
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
    </SidebarShell>
  );
}
