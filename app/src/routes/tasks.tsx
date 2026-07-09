import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Link2,
  ListTodo,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { EmptyState } from "#/components/empty-state.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Icon, IconProvider } from "#/lib/icons";
import { deletedToast, undoToast } from "#/lib/undo-client";
import {
  addLinkFn,
  addStepFn,
  createNoteFn,
  createTaskFn,
  deleteNoteFn,
  deleteStepFn,
  deleteTaskFn,
  enrichTaskFn,
  getTaskFn,
  listNotesFn,
  listTasksFn,
  prioritizeTasksFn,
  removeLinkFn,
  searchLinkTargetsFn,
  updateNoteFn,
  updateStepFn,
  updateTaskFn,
} from "#/server/tasks.ts";
import type {
  EntityRef,
  NoteRecord,
  TaskLink,
  TaskNode,
  TaskPriority,
  TaskStatus,
} from "#/db/tasks.server.ts";

/** Advisory-priority badge styling, lowest→highest. */
const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: "low", cls: "border-border text-muted-foreground" },
  medium: { label: "med", cls: "border-info/50 text-info" },
  high: { label: "high", cls: "border-warning/50 text-warning" },
  critical: { label: "crit", cls: "border-destructive/60 bg-destructive/10 text-destructive" },
};

function PriorityBadge({ priority, reason }: { priority: TaskPriority; reason: string | null }) {
  const m = PRIORITY_META[priority];
  return (
    <Tooltip content={reason ?? `priority: ${priority}`}>
      <span className={`shrink-0 border px-1 text-xs leading-tight font-medium ${m.cls}`}>
        {m.label}
      </span>
    </Tooltip>
  );
}

/** Workflow-status presentation: dot colour + whether to mute/strike the title. */
const STATUS_META: Record<TaskStatus, { label: string; dot: string; muted: boolean }> = {
  open: { label: "Open", dot: "bg-muted-foreground/40", muted: false },
  in_progress: { label: "In progress", dot: "bg-warning", muted: false },
  done: { label: "Done", dot: "bg-success", muted: true },
  closed: { label: "Closed", dot: "bg-muted-foreground", muted: true },
};
const STATUS_ORDER: TaskStatus[] = ["open", "in_progress", "done", "closed"];
const titleMuted = (s: TaskStatus) =>
  STATUS_META[s].muted ? "text-muted-foreground line-through" : "";

type Search = { tab?: "tasks" | "notes"; t?: number; n?: number };

export const Route = createFileRoute("/tasks")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: s.tab === "notes" ? "notes" : undefined,
    t: typeof s.t === "number" ? s.t : undefined,
    n: typeof s.n === "number" ? s.n : undefined,
  }),
  component: () => (
    <IconProvider>
      <TasksShell />
    </IconProvider>
  ),
});

/** Tasks/notes change from outside this tab too — the in-game mod (via the bridge)
 * and the assistant both write to the same store. Keep these queries fresh without
 * a reload: refetch on focus/reconnect (covers alt-tabbing back from the game) plus
 * a gentle visible-or-not interval (covers the web app sitting open on a second
 * monitor). A real-time push (SSE) is a later upgrade if we ever need instant. */
const LIVE_QUERY = {
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchInterval: 10_000,
  refetchIntervalInBackground: true,
} as const;

/** Per-project tasks & notes. Left: a task tree (parent tasks contain child
 * tasks) with a Notes tab. Right: the selected task (description + steps +
 * subtasks) or note. */
function TasksShell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const tab = search.tab ?? "tasks";
  const [filter, setFilter] = useState<Set<TaskStatus>>(() => new Set(STATUS_ORDER));
  const toggleStatus = (s: TaskStatus) =>
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => listTasksFn(), ...LIVE_QUERY });
  const noteList = useQuery({ queryKey: ["notes"], queryFn: () => listNotesFn(), ...LIVE_QUERY });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["task"] });
    void qc.invalidateQueries({ queryKey: ["notes"] });
  };

  const openTask = (id: number) => void navigate({ to: "/tasks", search: { tab: "tasks", t: id } });
  const openNote = (id: number) => void navigate({ to: "/tasks", search: { tab: "notes", n: id } });
  const showTab = (next: "tasks" | "notes") =>
    void navigate({ to: "/tasks", search: { tab: next === "notes" ? "notes" : undefined } });

  const newTask = useMutation({
    mutationFn: (parentId: number | null) => createTaskFn({ data: { parentId } }),
    onSuccess: ({ id }, parentId) => {
      refresh();
      if (parentId == null) openTask(id);
    },
  });
  const newNote = useMutation({
    mutationFn: () => createNoteFn({ data: {} }),
    onSuccess: ({ id }) => {
      refresh();
      openNote(id);
    },
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const prioritize = useMutation({
    mutationFn: () => prioritizeTasksFn(),
    onSuccess: (res) => {
      refresh();
      setActionError(res.ok ? null : res.error);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "prioritise failed"),
  });

  const nodes = tasks.data ?? [];
  const currentTask = nodes.find((t) => t.id === search.t) ?? null;
  const currentNote = (noteList.data ?? []).find((n) => n.id === search.n) ?? null;

  return (
    <SidebarShell
      width="w-72"
      label="Tasks"
      sidebarClassName="bg-card"
      sidebar={(close) => (
        <>
          <div className="flex items-stretch border-b border-border text-sm">
            <TabButton active={tab === "tasks"} onClick={() => showTab("tasks")}>
              <ListTodo className="size-4" /> Tasks
            </TabButton>
            <TabButton active={tab === "notes"} onClick={() => showTab("notes")}>
              <StickyNote className="size-4" /> Notes
            </TabButton>
            <div className="ml-auto flex items-center pr-2">
              <HelpButton title="Tasks & notes">
                <p>
                  A planning to-do list scoped to this project.{" "}
                  <span className="text-foreground">Tasks</span> are things to do — build,
                  investigate, fix; <span className="text-foreground">Notes</span> (the other tab)
                  are a free-form scratchpad.
                </p>
                <div>
                  <div className="font-semibold text-foreground">A task has</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      a <span className="text-foreground">status</span> (open / in progress / done /
                      closed) and an optional <span className="text-foreground">priority</span>;
                    </li>
                    <li>
                      <span className="text-foreground">steps</span> (its own checklist) and{" "}
                      <span className="text-foreground">subtasks</span> (child tasks);
                    </li>
                    <li>
                      a markdown <span className="text-foreground">description</span>;
                    </li>
                    <li>
                      <span className="text-foreground">links</span> to items, recipes, blocks, or
                      an in-game location/entity.
                    </li>
                  </ul>
                </div>
                <p>
                  <span className="text-foreground">In-game.</span> Capture tasks from the PyOps
                  panel in Factorio — they&apos;re anchored to where you were and the entity you
                  were looking at, so &quot;go to&quot; jumps you back there. Edits sync between
                  here and the game within a few seconds.
                </p>
                <p>
                  <span className="text-foreground">Prioritise</span> asks the assistant to rank
                  your open tasks.
                </p>
              </HelpButton>
            </div>
          </div>

          {tab === "tasks" ? (
            <>
              <div className="flex items-center justify-between gap-1 px-3 py-2">
                <FieldLabel>Task tree</FieldLabel>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => prioritize.mutate()}
                    disabled={prioritize.isPending}
                    title="Ask the assistant to prioritise open tasks"
                  >
                    {prioritize.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Prioritise
                  </Button>
                  <Button size="xs" onClick={() => newTask.mutate(null)}>
                    <Plus /> Task
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 px-2 pb-2">
                {STATUS_ORDER.map((s) => {
                  const on = filter.has(s);
                  const count = nodes.filter((n) => n.status === s).length;
                  return (
                    <Button
                      key={s}
                      variant="toggle"
                      size="xs"
                      aria-pressed={on}
                      onClick={() => toggleStatus(s)}
                      title={on ? `hide ${STATUS_META[s].label}` : `show ${STATUS_META[s].label}`}
                    >
                      <span className={`size-1.5 rounded-full ${STATUS_META[s].dot}`} />
                      {STATUS_META[s].label}
                      {count > 0 && <span className="tabular-nums">{count}</span>}
                    </Button>
                  );
                })}
              </div>
              {actionError && (
                <Callout tone="destructive" variant="strip" className="mb-1">
                  {actionError}
                </Callout>
              )}
              <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
                <TaskTree
                  nodes={nodes}
                  selected={search.t ?? null}
                  filter={filter}
                  onOpen={(id) => {
                    openTask(id);
                    close();
                  }}
                />
                {nodes.length === 0 && (
                  <EmptyState
                    className="px-2 py-3"
                    title="No tasks yet"
                    description="Add one to start a tree."
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2">
                <FieldLabel>Scratch notes</FieldLabel>
                <Button size="xs" onClick={() => newNote.mutate()}>
                  <Plus /> Note
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
                {(noteList.data ?? []).map((note) => (
                  <Button
                    key={note.id}
                    variant="ghost"
                    onClick={() => {
                      openNote(note.id);
                      close();
                    }}
                    className={`h-auto w-full justify-start px-2 py-1.5 font-normal ${
                      note.id === search.n ? "bg-accent" : ""
                    }`}
                    title={note.title ?? "Untitled note"}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {note.title || (
                        <span className="text-muted-foreground italic">Untitled note</span>
                      )}
                    </span>
                  </Button>
                ))}
                {(noteList.data?.length ?? 0) === 0 && (
                  <EmptyState
                    className="px-2 py-3"
                    title="No notes"
                    description="A scratch space for calcs & reminders."
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    >
      <div className="min-w-0 flex-1 overflow-auto">
        {tab === "tasks" ? (
          currentTask ? (
            <TaskDetail
              key={currentTask.id}
              id={currentTask.id}
              nodes={nodes}
              onOpen={openTask}
              onChanged={refresh}
            />
          ) : (
            <EmptyState
              className="h-full"
              icon={ListTodo}
              title="No task selected"
              description="Pick a task from the list, or create a new one."
              action={
                <Button size="sm" onClick={() => newTask.mutate(null)}>
                  <Plus /> New task
                </Button>
              }
            />
          )
        ) : currentNote ? (
          <NoteDetail
            key={currentNote.id}
            note={currentNote}
            onChanged={refresh}
            onDeleted={() => showTab("notes")}
          />
        ) : (
          <EmptyState
            className="h-full"
            icon={StickyNote}
            title="No note selected"
            description="Pick a note from the list, or jot a new one."
            action={
              <Button size="sm" onClick={() => newNote.mutate()}>
                <Plus /> New note
              </Button>
            }
          />
        )}
      </div>
    </SidebarShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-pressed={active}
      className={`h-auto flex-1 justify-center gap-1.5 border-0 border-b-2 py-2 ${
        active ? "border-b-primary text-foreground" : "border-b-transparent text-muted-foreground"
      }`}
    >
      {children}
    </Button>
  );
}

/** Combined progress across a task's own steps and its direct children. */
function rollup(n: TaskNode): { done: number; total: number } {
  return { done: n.stepDone + n.childDone, total: n.stepTotal + n.childTotal };
}

/** Segmented control to set a task's workflow status. */
function StatusPills({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (s: TaskStatus) => void;
}) {
  return (
    <Segmented
      aria-label="task status"
      size="sm"
      value={status}
      onValueChange={onChange}
      options={STATUS_ORDER.map((s) => ({
        value: s,
        label: (
          <>
            <span className={`size-2 rounded-full ${STATUS_META[s].dot}`} />
            {STATUS_META[s].label}
          </>
        ),
      }))}
    />
  );
}

/* ── task tree (sidebar) ──────────────────────────────────────────────────────── */

function TaskTree({
  nodes,
  selected,
  filter,
  onOpen,
}: {
  nodes: TaskNode[];
  selected: number | null;
  filter: Set<TaskStatus>;
  onOpen: (id: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const byParent = new Map<number, TaskNode[]>();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  const roots = nodes.filter((n) => n.parentId == null);

  // A node is visible if its own status passes the filter OR it has a visible
  // descendant (so an ancestor stays as scaffolding for a matching child).
  const visible = new Set<number>();
  const mark = (node: TaskNode): boolean => {
    let anyChild = false;
    for (const c of byParent.get(node.id) ?? []) if (mark(c)) anyChild = true;
    const show = filter.has(node.status) || anyChild;
    if (show) visible.add(node.id);
    return show;
  };
  roots.forEach(mark);

  const render = (node: TaskNode, depth: number): ReactNode => {
    if (!visible.has(node.id)) return null;
    const children = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
    const isCollapsed = collapsed.has(node.id);
    const r = rollup(node);
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 px-1 py-1 text-sm hover:bg-muted ${
            node.id === selected ? "bg-accent" : ""
          }`}
          style={{ paddingLeft: depth * 14 + 4 }}
        >
          {children.length > 0 ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                setCollapsed((s) => {
                  const next = new Set(s);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={isCollapsed ? "expand" : "collapse"}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </Button>
          ) : (
            <span className="inline-block size-6 shrink-0" />
          )}
          <span
            className={`size-2 shrink-0 rounded-full ${STATUS_META[node.status].dot}`}
            title={STATUS_META[node.status].label}
          />
          <button
            onClick={() => onOpen(node.id)}
            className={`min-w-0 flex-1 truncate text-left ${titleMuted(node.status)}`}
            title={node.title ?? "Untitled task"}
          >
            {node.title || <span className="text-muted-foreground italic">Untitled task</span>}
          </button>
          {node.priority && <PriorityBadge priority={node.priority} reason={node.priorityReason} />}
          {r.total > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {r.done}/{r.total}
            </span>
          )}
        </div>
        {!isCollapsed && children.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return <>{roots.map((n) => render(n, 0))}</>;
}

/* ── task detail ──────────────────────────────────────────────────────────────── */

function TaskDetail({
  id,
  nodes,
  onOpen,
  onChanged,
}: {
  id: number;
  nodes: TaskNode[];
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const task = useQuery({
    queryKey: ["task", id],
    queryFn: () => getTaskFn({ data: id }),
    ...LIVE_QUERY,
  });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (patch: { title?: string | null; body?: string | null; status?: TaskStatus }) =>
      updateTaskFn({ data: { id, ...patch } }),
    onSuccess: onChanged,
  });
  // Task/subtask/step deletion happens immediately, no confirm (#83): the
  // server logs it to the undo log, so the toast's Undo restores everything
  // (a task comes back with its subtasks and steps).
  const removeTask = useMutation({
    mutationFn: () => deleteTaskFn({ data: id }),
    onSuccess: () => {
      deletedToast(qc, task.data?.title || "Untitled task");
      onChanged();
      void navigate({ to: "/tasks", search: { tab: "tasks" } });
    },
  });
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const enrich = useMutation({
    mutationFn: () => enrichTaskFn({ data: id }),
    onSuccess: (res) => {
      onChanged();
      setEnrichError(res.ok ? null : res.error);
    },
    onError: (e) => setEnrichError(e instanceof Error ? e.message : "enhance failed"),
  });
  const toggleChild = useMutation({
    mutationFn: (d: { id: number; done: boolean }) => updateTaskFn({ data: d }),
    onSuccess: onChanged,
  });
  const removeChild = useMutation({
    mutationFn: (child: { id: number; title: string | null }) => deleteTaskFn({ data: child.id }),
    onSuccess: (_res, child) => {
      deletedToast(qc, child.title || "Untitled task");
      onChanged();
    },
  });
  const addChild = useMutation({
    mutationFn: (title: string) => createTaskFn({ data: { parentId: id, title } }),
    onSuccess: onChanged,
  });
  const addStep = useMutation({
    mutationFn: (text: string) => addStepFn({ data: { taskId: id, text } }),
    onSuccess: onChanged,
  });
  const updateStep = useMutation({
    mutationFn: (d: { id: number; text?: string; done?: boolean }) => updateStepFn({ data: d }),
    onSuccess: onChanged,
  });
  const removeStep = useMutation({
    mutationFn: (stepId: number) => deleteStepFn({ data: stepId }),
    onSuccess: () => {
      undoToast(qc, "Deleted step");
      onChanged();
    },
  });

  const [title, setTitle] = useState("");
  const [newStep, setNewStep] = useState("");
  const [newChild, setNewChild] = useState("");
  useEffect(() => {
    if (task.data) setTitle(task.data.title ?? "");
  }, [task.data]);

  if (!task.data)
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  const t = task.data;
  const parent = t.parentId != null ? nodes.find((n) => n.id === t.parentId) : null;

  const submitStep = () => {
    const text = newStep.trim();
    if (!text) return;
    addStep.mutate(text);
    setNewStep("");
  };
  const submitChild = () => {
    const text = newChild.trim();
    if (!text) return;
    addChild.mutate(text);
    setNewChild("");
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
      {parent && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onOpen(parent.id)}
          className="-mb-2 self-start px-1 font-normal text-muted-foreground hover:text-foreground"
        >
          ↑ {parent.title || "Untitled task"}
        </Button>
      )}

      <div className="flex items-start gap-3">
        <Input
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          onBlur={() => title !== (t.title ?? "") && save.mutate({ title })}
          placeholder="Task title"
          className={`h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-lg font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:ring-0 md:text-lg dark:bg-transparent ${titleMuted(
            t.status,
          )}`}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => enrich.mutate()}
          disabled={enrich.isPending}
          title="Enhance: let the assistant sharpen this task's title & description"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {enrich.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => removeTask.mutate()}
          title="delete task (undoable)"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusPills status={t.status} onChange={(s) => save.mutate({ status: s })} />
        {t.priority && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <PriorityBadge priority={t.priority} reason={t.priorityReason} />
            {t.priorityReason}
          </span>
        )}
      </div>
      {enrichError && (
        <Callout tone="destructive" className="-mt-2">
          Enhance failed: {enrichError}
        </Callout>
      )}

      <MarkdownField
        value={t.body ?? ""}
        placeholder="What to do — markdown ok"
        onSave={(body) => body !== (t.body ?? "") && save.mutate({ body })}
      />

      <LinksSection
        taskId={id}
        links={t.links}
        onChanged={onChanged}
        onOpenBlock={(blockId) =>
          void navigate({ to: "/block/$id", params: { id: String(blockId) } })
        }
      />

      <Section label="Steps">
        {t.steps.map((s) => (
          <CheckRow
            key={s.id}
            text={s.text}
            done={s.done}
            onToggle={() => updateStep.mutate({ id: s.id, done: !s.done })}
            onEdit={(text) => text !== s.text && updateStep.mutate({ id: s.id, text })}
            onDelete={() => removeStep.mutate(s.id)}
          />
        ))}
        <AddRow
          value={newStep}
          onChange={setNewStep}
          onSubmit={submitStep}
          placeholder="Add a step…"
        />
      </Section>

      <Section label="Subtasks">
        {t.children.map((c) => {
          const r = rollup(c);
          return (
            <div key={c.id} className="group flex items-center gap-2">
              <Checkbox
                checked={c.done}
                onCheckedChange={() => toggleChild.mutate({ id: c.id, done: !c.done })}
              />
              <button
                onClick={() => onOpen(c.id)}
                className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-sm hover:underline ${titleMuted(
                  c.status,
                )}`}
                title={`${c.title ?? "Untitled task"} · ${STATUS_META[c.status].label}`}
              >
                <span className={`size-1.5 shrink-0 rounded-full ${STATUS_META[c.status].dot}`} />
                {c.title || <span className="text-muted-foreground italic">Untitled task</span>}
              </button>
              {r.total > 0 && (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {r.done}/{r.total}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeChild.mutate({ id: c.id, title: c.title })}
                title="delete subtask (undoable)"
                className="hidden shrink-0 text-muted-foreground group-hover:inline-flex hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <AddRow
          value={newChild}
          onChange={setNewChild}
          onSubmit={submitChild}
          placeholder="Add a subtask…"
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function AddRow({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            onSubmit();
          }
        }}
        onBlur={onSubmit}
        placeholder={placeholder}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}

/** Checkbox + inline-editable text + delete (used for steps). */
function CheckRow({
  text,
  done,
  onToggle,
  onEdit,
  onDelete,
}: {
  text: string;
  done: boolean;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(text);
  const ref = useRef(text);
  ref.current = text;
  useEffect(() => setValue(text), [text]);
  return (
    <div className="group flex items-center gap-2">
      <Checkbox checked={done} onCheckedChange={onToggle} />
      <Input
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => value.trim() && value.trim() !== ref.current && onEdit(value.trim())}
        className={`h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 focus-visible:ring-0 dark:bg-transparent ${
          done ? "text-muted-foreground line-through" : ""
        }`}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        title="remove"
        className="hidden shrink-0 text-muted-foreground group-hover:inline-flex hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

/** Rendered markdown that turns into a textarea on click; saves on blur. */
function MarkdownField({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={() => {
          setEditing(false);
          onSave(draft);
        }}
        placeholder={placeholder}
        rows={Math.max(4, draft.split("\n").length + 1)}
        className="w-full resize-y bg-background p-3 font-mono leading-relaxed"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full border border-transparent p-3 text-left hover:border-border"
      title="click to edit"
    >
      {value.trim() ? (
        <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
          <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground/60">{placeholder}</span>
      )}
    </button>
  );
}

/* ── entity links ─────────────────────────────────────────────────────────────── */

const ICON_KINDS = new Set(["item", "fluid", "recipe", "entity", "technology"]);

/** Render an entity's icon, coercing the stored kind to one <Icon> accepts (a
 * block carries its product's icon). Falls back to a neutral square. */
function ChipIcon({ kind, name }: { kind: string | null; name: string | null }) {
  if (kind === "location") return <MapPin className="size-3.5 text-muted-foreground" />;
  if (!name) return <span className="inline-block size-4 bg-muted" />;
  const k = (kind && ICON_KINDS.has(kind) ? kind : "item") as
    | "item"
    | "fluid"
    | "recipe"
    | "entity"
    | "technology";
  return <Icon kind={k} name={name} size="sm" noTitle />;
}

function LinksSection({
  taskId,
  links,
  onChanged,
  onOpenBlock,
}: {
  taskId: number;
  links: TaskLink[];
  onChanged: () => void;
  onOpenBlock: (blockId: number) => void;
}) {
  const removeLink = useMutation({
    mutationFn: (id: number) => removeLinkFn({ data: id }),
    onSuccess: onChanged,
  });
  return (
    <Section label="Links">
      <div className="flex flex-wrap items-center gap-1.5">
        {links.map((l) => (
          <LinkChip
            key={l.id}
            link={l}
            onRemove={() => removeLink.mutate(l.id)}
            onOpenBlock={onOpenBlock}
          />
        ))}
        <LinkPicker taskId={taskId} existing={links} onAdded={onChanged} />
      </div>
    </Section>
  );
}

function LinkChip({
  link,
  onRemove,
  onOpenBlock,
}: {
  link: TaskLink;
  onRemove: () => void;
  onOpenBlock: (blockId: number) => void;
}) {
  const inner = (
    <span className="inline-flex items-center gap-1">
      <ChipIcon kind={link.iconKind} name={link.iconName} />
      <span className="max-w-[16rem] truncate">{link.display}</span>
    </span>
  );
  const clickable = link.kind === "block" && link.blockId != null;
  return (
    <span className="group inline-flex items-center gap-1 border border-border bg-muted/40 py-0.5 pr-0.5 pl-1 text-sm">
      {clickable ? (
        <button
          onClick={() => onOpenBlock(link.blockId!)}
          className="inline-flex items-center gap-1 hover:underline"
          title={`open ${link.display}`}
        >
          {inner}
        </button>
      ) : (
        <span title={link.refName}>{inner}</span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        title="remove link"
        className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}

/** "+ link" affordance that opens a search across goods / recipes / techs /
 * blocks; clicking a result attaches it. Stays open for adding several. */
function LinkPicker({
  taskId,
  existing,
  onAdded,
}: {
  taskId: number;
  existing: TaskLink[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const results = useQuery({
    queryKey: ["link-search", q],
    queryFn: () => searchLinkTargetsFn({ data: q }),
    enabled: open && q.trim().length > 0,
  });
  const add = useMutation({
    mutationFn: (ref: EntityRef) =>
      addLinkFn({ data: { taskId, kind: ref.kind, refName: ref.refName } }),
    onSuccess: onAdded,
  });
  const linked = new Set(existing.map((l) => `${l.kind}:${l.refName}`));

  if (!open)
    return (
      <Button
        variant="outline"
        size="xs"
        onClick={() => setOpen(true)}
        className="border-dashed font-normal text-muted-foreground hover:border-solid hover:text-foreground"
      >
        <Link2 className="size-3.5" /> link
      </Button>
    );

  return (
    <div className="relative">
      <Input
        autoFocus
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(ev) => ev.key === "Escape" && setOpen(false)}
        placeholder="search anything…"
        title="items, recipes, techs, and blocks"
        className="w-64"
      />
      {(results.data?.length ?? 0) > 0 && (
        <div className="absolute z-10 mt-1 max-h-72 w-72 overflow-auto border border-border bg-card shadow-lg">
          {results.data!.map((r) => {
            const already = linked.has(`${r.kind}:${r.refName}`);
            return (
              <Button
                key={`${r.kind}:${r.refName}`}
                variant="ghost"
                disabled={already}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  add.mutate(r);
                  setQ("");
                }}
                className="h-auto w-full justify-start gap-2 px-2 py-1 font-normal"
              >
                <ChipIcon kind={r.iconKind} name={r.iconName} />
                <span className="min-w-0 flex-1 truncate text-left">{r.display}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{r.kind}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── note detail ──────────────────────────────────────────────────────────────── */

function NoteDetail({
  note,
  onChanged,
  onDeleted,
}: {
  note: NoteRecord;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body ?? "");
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: { title?: string | null; body?: string | null }) =>
      updateNoteFn({ data: { id: note.id, ...patch } }),
    onSuccess: onChanged,
  });
  // No confirm (#83) — note deletion is undo-logged; the toast's Undo restores it.
  const remove = useMutation({
    mutationFn: () => deleteNoteFn({ data: note.id }),
    onSuccess: () => {
      deletedToast(qc, note.title || "Untitled note");
      onChanged();
      onDeleted();
    },
  });

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <Input
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          onBlur={() => title !== (note.title ?? "") && save.mutate({ title })}
          placeholder="Note title"
          className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-lg font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:ring-0 md:text-lg dark:bg-transparent"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => remove.mutate()}
          title="delete note (undoable)"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X />
        </Button>
      </div>
      <Textarea
        value={body}
        onChange={(ev) => setBody(ev.target.value)}
        onBlur={() => body !== (note.body ?? "") && save.mutate({ body })}
        placeholder="Quick notes — markdown ok"
        className="min-h-0 w-full flex-1 resize-none bg-background p-3 font-mono leading-relaxed"
      />
    </div>
  );
}
