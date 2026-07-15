import { createFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Plus,
  Power,
  X,
} from "lucide-react";
import { Icon, IconProvider } from "../lib/icons";
import { blockDeleteDescription } from "../lib/delete-copy";
import { deletedToast, undoToast } from "../lib/undo-client";
import { Button } from "#/components/ui/button.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { useFilteredList } from "../lib/use-filtered-list";
import { BlockFolderMenu } from "../components/block-folder-menu.tsx";
import { createBlockInGroupFn } from "../server/block-folders.ts";

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

/** A sidebar tree row that is both a dnd-kit drag source and a drop target. The
 * whole row is the drag activator — the mouse/touch sensors (a small move on
 * mouse, a short press-hold on touch) distinguish a drag from a tap-to-open or a
 * list scroll, so no separate grip handle is needed. */
function DndRow({
  id,
  className,
  style,
  onContextMenu,
  children,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  return (
    <div
      ref={setRef}
      style={style}
      className={`${className ?? ""} ${drag.isDragging ? "opacity-40" : ""}`}
      onContextMenu={onContextMenu}
      {...drag.listeners}
    >
      {children}
    </div>
  );
}

/** A droppable-only sidebar target — the Ungrouped pseudo-folder, which accepts
 * drops but can't itself be dragged. */
function DropZone({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

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
  // the sidebar row currently being dragged (dnd-kit id: "b<id>" block | "g<id>" folder)
  const [dragKey, setDragKey] = useState<string | null>(null);
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
  // block awaiting delete confirmation (the sidebar ×) — drives the ConfirmDialog
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    name: string;
    recipeCount: number;
    goalCount: number;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    id: number;
    name: string;
  } | null>(null);
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
    setDragKey(null);
    setDropBlock(null);
    setDropFolder(null);
  };

  // ── Sidebar drag-and-drop (dnd-kit) ──────────────────────────────────────────
  // Rows are draggable + droppable with ids "b<id>" (block) / "g<id>" (folder) /
  // "ungrouped". The whole row drags; separate mouse/touch sensors keep that from
  // clobbering a tap or a scroll — mouse needs a 5px move, touch a 200ms press-hold
  // (an immediate finger-drag scrolls the list instead).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const pointerY = (e: DragOverEvent | DragEndEvent) =>
    ((e.activatorEvent as PointerEvent).clientY ?? 0) + e.delta.y;

  // Where the active row would land over `overId` with the pointer at `pointerY` —
  // mirrors the old native-drag rules. Returns the drop-indicator to show/apply.
  const computeDrop = (
    activeKey: string,
    overId: string,
    rect: { top: number; height: number },
    y: number,
  ): { block?: { id: number; after: boolean }; folder?: { key: string; into: boolean } } | null => {
    if (overId === activeKey) return null;
    const draggingFolder = activeKey.startsWith("g");
    if (overId.startsWith("b")) {
      if (draggingFolder) return null; // a folder can't nest into a block
      return { block: { id: Number(overId.slice(1)), after: y > rect.top + rect.height / 2 } };
    }
    // a folder header / Ungrouped: a dragged folder reorders in the top sliver and
    // nests in the rest; a dragged block always nests
    const into = draggingFolder && overId !== "ungrouped" ? y > rect.top + rect.height * 0.4 : true;
    return { folder: { key: overId, into } };
  };

  const onDragStart = (e: DragStartEvent) => setDragKey(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const drop =
      e.over && computeDrop(String(e.active.id), String(e.over.id), e.over.rect, pointerY(e));
    setDropBlock(drop?.block ?? null);
    setDropFolder(drop?.folder ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) {
      const activeKey = String(e.active.id);
      const aId = Number(activeKey.slice(1));
      const drop = computeDrop(activeKey, String(e.over.id), e.over.rect, pointerY(e));
      if (drop?.block) {
        const target = byId.get(drop.block.id);
        if (target) void dropBlockAt(aId, target, drop.block.after);
      } else if (drop?.folder) {
        const groupId = drop.folder.key === "ungrouped" ? null : Number(drop.folder.key.slice(1));
        if (!activeKey.startsWith("g")) void moveToGroup(aId, groupId);
        else if (drop.folder.into) void moveGroup(aId, groupId);
        else {
          const target = (groups.data ?? []).find((g) => g.id === groupId);
          if (target) void dropFolderBefore(aId, target);
        }
      }
    }
    endDrag();
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
  // No confirm — deleting a folder destroys nothing (its blocks and subfolders
  // move up to its parent) and the undo toast covers a misclick (#83).
  const deleteFolder = async (g: { id: number; name: string }) => {
    await deleteGroupFn({ data: g.id });
    undoToast(qc, `Deleted folder "${g.name}" — its blocks moved up`);
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
  const newBlock = async (groupId?: number) => {
    const res =
      groupId == null
        ? await saveBlockFn({
            data: { name: "New block", data: { goals: [], recipes: [] } },
          })
        : await createBlockInGroupFn({ data: groupId });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    open(res.id);
  };
  const closeTab = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    // navigate OUTSIDE the state updater — updaters run during render, and
    // navigating there sets router state mid-render (React warns on it)
    const next = openTabs.filter((x) => x !== id);
    setOpenTabs(next);
    if (activeId === id) {
      const nb = next[next.length - 1];
      void navigate(
        nb != null ? { to: "/block/$id", params: { id: String(nb) } } : { to: "/block" },
      );
    }
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
  // Deleting a block is the big destructive action here: a proper confirm
  // dialog stating what's destroyed (#83), then an undo toast — the deletion
  // is logged server-side, so Undo restores the whole block.
  const del = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete(byId.get(id) ?? null);
  };
  const confirmDelete = async () => {
    const b = pendingDelete;
    if (!b) return;
    setPendingDelete(null);
    await deleteBlockFn({ data: b.id });
    deletedToast(qc, b.name);
    setOpenTabs((t) => t.filter((x) => x !== b.id));
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    if (activeId === b.id) void navigate({ to: "/block" });
  };

  // block names are user-typed (no internal-name fallback); the tree render
  // regroups matches by folder, so ranking only reorders within a folder
  const filtered = useFilteredList(blocks.data ?? [], search, { display: (b) => b.name });

  type Row = (typeof filtered)[number];
  type Group = NonNullable<typeof groups.data>[number];

  // Block-health indicators for the sidebar/tabs: red for broken refs / infeasible
  // solves, amber for unmade goals or a relaxed/underdetermined solve. The verdict
  // is computed server-side in listBlocks (no re-solve).
  type Health = "ok" | "warn" | "error";
  const healthRank: Record<Health, number> = { ok: 0, warn: 1, error: 2 };
  // tint the block/folder NAME (not just the icon) so a problem reads at a glance
  const healthText = (h: Health) =>
    h === "error" ? "text-destructive" : h === "warn" ? "text-warning" : "";
  const healthBadge = (h: Health, tip: string) =>
    h === "ok" ? null : (
      <Tooltip content={tip}>
        <span className={`shrink-0 ${h === "error" ? "text-destructive" : "text-warning"}`}>
          <AlertTriangle className="size-3.5" />
        </span>
      </Tooltip>
    );
  const blockHealthTip = (b: Row) =>
    b.broken
      ? "References a recipe/good that no longer exists — open to see what's missing"
      : b.health === "error"
        ? "This block has no exact solution — open to fix"
        : b.unmadeGoals.length
          ? `${b.unmadeGoals.length} goal${b.unmadeGoals.length === 1 ? "" : "s"} with no recipe yet — open to add one`
          : "This block needs attention — open to see";
  // worst health among every block in a folder subtree (errors dominate warnings),
  // so a problem nested anywhere bubbles up to the folder header.
  const groupHealth = (groupId: number): Health => {
    let worst: Health = "ok";
    const visit = (gid: number) => {
      for (const b of blocks.data ?? [])
        if (b.groupId === gid && healthRank[b.health] > healthRank[worst]) worst = b.health;
      for (const k of childrenOf(gid)) visit(k.id);
    };
    visit(groupId);
    return worst;
  };
  const renderBlock = (b: Row, depth: number) => (
    <DndRow
      key={b.id}
      id={`b${b.id}`}
      style={{ marginLeft: 8 + depth * 12 }}
      className={`group relative flex cursor-grab items-center gap-2 px-2 py-1 select-none hover:bg-muted active:cursor-grabbing ${activeId === b.id ? "bg-accent" : ""}`}
    >
      {dropBlock?.id === b.id && (
        <div
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 bg-primary ${dropBlock.after ? "-bottom-px" : "-top-px"}`}
        />
      )}
      <button
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${b.enabled === false ? "opacity-45" : ""}`}
        onClick={() => open(b.id)}
      >
        {b.iconName && (
          // noHover: the icon just badges the block's name here — an item hover
          // card in the nav list is noise, not information.
          <Icon
            kind={(b.iconKind ?? "item") as IconKind}
            name={b.iconName}
            size="sm"
            noTitle
            noHover
          />
        )}
        <span
          className={`truncate text-sm ${b.enabled === false ? "line-through" : ""} ${healthText(b.health)}`}
        >
          {b.name}
        </span>
        {b.enabled === false && (
          <Power className="size-3 shrink-0 text-warning" aria-label="Disabled" />
        )}
        {healthBadge(b.health, blockHealthTip(b))}
      </button>
      {/* Raw button on purpose: hover-revealed glyph inside a drag row — a
          Button box would change the row's density/hit-testing. */}
      <button
        className="px-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        title="Delete"
        onClick={(e) => del(b.id, e)}
      >
        <X className="size-3.5" />
      </button>
    </DndRow>
  );
  // A real folder, rendered recursively: its subfolders (nested) then its blocks.
  // Dropping a folder on the top sliver reorders it before this one; lower down nests
  // it inside. Dropping a block always nests it here.
  const renderFolder = (group: Group, depth: number) => {
    const key = `g${group.id}`;
    const isCol = collapsed[key];
    const rows = filtered.filter((b) => b.groupId === group.id);
    const kids = childrenOf(group.id);
    const gHealth = groupHealth(group.id);
    const showInto = dropFolder?.key === key && dropFolder.into;
    const showLine = dropFolder?.key === key && !dropFolder.into;
    return (
      <div key={key}>
        <DndRow
          id={key}
          style={{ marginLeft: depth * 12 }}
          onContextMenu={(e) => {
            e.preventDefault();
            setFolderMenu({ x: e.clientX, y: e.clientY, id: group.id, name: group.name });
          }}
          className={`group relative flex cursor-grab items-center gap-1 px-1 py-1 text-sm font-semibold tracking-wide text-muted-foreground select-none hover:bg-muted/50 active:cursor-grabbing ${showInto ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
        >
          {showLine && (
            <div className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 bg-primary" />
          )}
          <button className="flex w-4 shrink-0 justify-center" onClick={() => toggle(key)}>
            {isCol ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span
            className={`min-w-0 flex-1 truncate ${healthText(gHealth)}`}
            onDoubleClick={() => renameFolder(group.id, group.name)}
          >
            {group.name} ({rows.length})
          </span>
          {healthBadge(
            gHealth,
            gHealth === "error"
              ? "A block in this folder has an error — expand to find it"
              : "A block in this folder needs attention — expand to find it",
          )}
          <button
            className="px-1 opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="Delete folder"
            onClick={() => void deleteFolder(group)}
          >
            <X className="size-3.5" />
          </button>
        </DndRow>
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
        <DropZone
          id={key}
          className={`group flex items-center gap-1 px-1 py-1 text-sm font-semibold tracking-wide text-muted-foreground hover:bg-muted/50 ${showInto ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
        >
          <button className="flex w-4 shrink-0 justify-center" onClick={() => toggle(key)}>
            {isCol ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span className="min-w-0 flex-1 truncate">Ungrouped ({rows.length})</span>
        </DropZone>
        {!isCol && rows.map((b) => renderBlock(b, 0))}
      </div>
    );
  };

  // What the cursor carries during a sidebar drag (rendered in the DragOverlay).
  const dragPreview = () => {
    if (!dragKey) return null;
    if (dragKey.startsWith("b")) {
      const b = byId.get(Number(dragKey.slice(1)));
      return b ? (
        <div className="flex items-center gap-2 border border-border bg-card px-2 py-1 text-sm shadow-lg">
          {b.iconName && (
            <Icon
              kind={(b.iconKind ?? "item") as IconKind}
              name={b.iconName}
              size="sm"
              noTitle
              noHover
            />
          )}
          <span className="truncate">{b.name}</span>
        </div>
      ) : null;
    }
    const g = (groups.data ?? []).find((x) => `g${x.id}` === dragKey);
    return g ? (
      <div className="border border-border bg-card px-2 py-1 text-sm font-semibold tracking-wide shadow-lg">
        {g.name}
      </div>
    ) : null;
  };

  return (
    <>
      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete block"
        description={
          pendingDelete
            ? blockDeleteDescription(
                pendingDelete.name,
                pendingDelete.recipeCount,
                pendingDelete.goalCount,
              )
            : ""
        }
        confirmLabel="Delete block"
        onConfirm={() => void confirmDelete()}
      />
      {folderMenu && (
        <BlockFolderMenu
          x={folderMenu.x}
          y={folderMenu.y}
          name={folderMenu.name}
          onCreateBlock={() => void newBlock(folderMenu.id)}
          onClose={() => setFolderMenu(null)}
        />
      )}
      <SidebarShell
        className="bg-background font-mono text-foreground"
        width="w-64"
        label="Blocks"
        sidebar={
          <>
            <div className="flex items-center gap-2 border-b border-border px-2 py-2">
              <FieldLabel className="font-semibold">Blocks ({blocks.data?.length ?? 0})</FieldLabel>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={newFolder}
                title="New folder"
                className="ml-auto"
              >
                <FolderPlus className="size-4" />
              </Button>
              <Button size="icon-sm" onClick={() => void newBlock()} title="New block">
                <Plus className="size-4" />
              </Button>
            </div>
            <FilterInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search blocks…"
              className="m-2"
            />
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={endDrag}
            >
              <div className="flex-1 overflow-auto px-1 pb-2">
                {blocks.isPending ? (
                  <div className="space-y-1.5 px-2 py-2">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-4/5" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                ) : (blocks.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    className="p-4"
                    icon={Boxes}
                    title="No blocks yet"
                    description={
                      <>
                        Create your first block with the{" "}
                        <Plus className="inline size-3.5" aria-label="New block" /> button above.
                      </>
                    }
                    action={
                      <Button size="sm" onClick={() => void newBlock()}>
                        <Plus /> New block
                      </Button>
                    }
                  />
                ) : (
                  <>
                    {childrenOf(null).map((g) => renderFolder(g, 0))}
                    {renderUngrouped()}
                    {filtered.length === 0 && (
                      <FilterEmptyState
                        className="p-4"
                        query={search}
                        onClear={() => setSearch("")}
                      />
                    )}
                  </>
                )}
              </div>
              <DragOverlay dropAnimation={null}>{dragPreview()}</DragOverlay>
            </DndContext>
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
                    noHover
                  />
                )}
                <span className={`max-w-[10rem] truncate ${b ? healthText(b.health) : ""}`}>
                  {b?.name ?? `#${id}`}
                </span>
                {b && healthBadge(b.health, blockHealthTip(b))}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => closeTab(id, e)}
                  className="flex items-center px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </span>
              </button>
            );
          })}
          <button
            onClick={() => void newBlock()}
            title="New block (or middle-click the empty tab strip)"
            className="flex shrink-0 items-center px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          {openTabs.length === 0 && (
            <div className="px-3 py-1.5 text-sm text-muted-foreground">No open blocks</div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ActiveEditorRefContext.Provider value={activeEditorRef}>
            <Outlet />
          </ActiveEditorRefContext.Provider>
        </div>
      </SidebarShell>
    </>
  );
}
