import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { IconProvider } from "#/lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { ChatPane, ChatPaneSkeleton } from "#/components/assistant/chat-view.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { toast } from "#/lib/toast-store";
import {
  activeAssistantRunsFn,
  deleteConversationFn,
  listConversationsFn,
  renameConversationFn,
} from "#/server/conversations.ts";
import { dropChat } from "#/lib/chat-store.ts";
import { runningKey, subscribeRuns } from "#/lib/chat-runs.ts";

export const Route = createFileRoute("/assistant")({
  validateSearch: (s: Record<string, unknown>): { c?: string } =>
    typeof s.c === "string" ? { c: s.c } : {},
  component: () => (
    <IconProvider>
      <AssistantShell />
    </IconProvider>
  ),
});

/** Conversation list + the active chat. Conversations persist per-project; a fresh
 * id is minted for a new chat and only saved once it has a completed turn. */
function AssistantShell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { c } = Route.useSearch();
  const selected = c ?? null;
  // Every chat opened this session stays mounted (hidden when inactive) so
  // switching the active chat never stops an in-flight run.
  const [openIds, setOpenIds] = useState<string[]>([]);
  // chat awaiting delete confirmation — drives the ConfirmDialog
  const [removing, setRemoving] = useState<{ id: string; title: string | null } | null>(null);

  // the active chat lives in the URL (linkable); mint one if absent
  useEffect(() => {
    if (!selected) {
      void navigate({ to: "/assistant", search: { c: crypto.randomUUID() }, replace: true });
    }
  }, [selected, navigate]);
  useEffect(() => {
    if (selected) setOpenIds((ids) => (ids.includes(selected) ? ids : [...ids, selected]));
  }, [selected]);

  const list = useQuery({ queryKey: ["conversations"], queryFn: () => listConversationsFn() });
  const activeRuns = useQuery({
    queryKey: ["assistant-active-runs"],
    queryFn: () => activeAssistantRunsFn(),
    refetchInterval: 2000,
  });
  const refreshList = () => void qc.invalidateQueries({ queryKey: ["conversations"] });
  // which conversations are generating right now (live, from the store)
  const runKey = useSyncExternalStore(subscribeRuns, runningKey, () => "");
  const running = new Set([...(runKey ? runKey.split(",") : []), ...(activeRuns.data ?? [])]);
  // the store persists/titles on its own (even with no pane mounted); refresh the
  // sidebar whenever it signals a change
  useEffect(
    () => subscribeRuns(() => void qc.invalidateQueries({ queryKey: ["conversations"] })),
    [qc],
  );

  const newChat = () => void navigate({ to: "/assistant", search: { c: crypto.randomUUID() } });
  const openChat = (id: string) => void navigate({ to: "/assistant", search: { c: id } });
  const rename = async (id: string, current: string | null) => {
    const t = window.prompt("Rename chat", current ?? "")?.trim();
    if (!t) return;
    await renameConversationFn({ data: { id, title: t } });
    refreshList();
  };
  // Chat deletion is permanent (conversations aren't in the undo log), so it
  // gets a real confirm dialog and its toast has no Undo button (#83).
  const remove = async (conv: { id: string; title: string | null }) => {
    setRemoving(null);
    dropChat(conv.id);
    await deleteConversationFn({ data: conv.id });
    toast({ message: `Deleted chat "${conv.title ?? "Untitled"}"` });
    setOpenIds((ids) => ids.filter((x) => x !== conv.id));
    if (conv.id === selected) newChat();
    refreshList();
  };

  return (
    <SidebarShell
      width="w-60"
      label="Chats"
      sidebarClassName="bg-card"
      sidebar={(close) => (
        <>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold tracking-wide text-muted-foreground">Chats</span>
            <Button
              size="sm"
              onClick={() => {
                newChat();
                close();
              }}
            >
              <Plus className="size-3.5" /> New
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
            {(list.data ?? []).map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 px-2 py-1.5 text-sm hover:bg-muted ${
                  conv.id === selected ? "bg-accent" : ""
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    running.has(conv.id) ? "animate-pulse bg-primary" : "bg-transparent"
                  }`}
                  title={running.has(conv.id) ? "Running…" : undefined}
                />
                <button
                  onClick={() => {
                    openChat(conv.id);
                    close();
                  }}
                  className="min-w-0 flex-1 truncate text-left"
                  title={conv.title ?? "Untitled"}
                >
                  {conv.title ?? "Untitled"}
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void rename(conv.id, conv.title)}
                  title="Rename"
                  className="hidden text-muted-foreground group-hover:inline-flex hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setRemoving({ id: conv.id, title: conv.title })}
                  title="Delete"
                  className="hidden text-muted-foreground group-hover:inline-flex hover:text-destructive"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            {list.isLoading && (
              <div className="space-y-1 px-2 py-1">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-2/3" />
              </div>
            )}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">No saved chats yet</div>
            )}
          </div>
        </>
      )}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {openIds.map((id) => (
          <ChatPane key={id} id={id} active={id === selected} />
        ))}
        {openIds.length === 0 && <ChatPaneSkeleton />}
        <ConfirmDialog
          open={removing != null}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          title="Delete chat"
          description={
            removing
              ? `Delete "${removing.title ?? "Untitled"}"? Its messages are removed permanently — chats aren't covered by undo.`
              : ""
          }
          confirmLabel="Delete chat"
          onConfirm={() => {
            if (removing) void remove(removing);
          }}
        />
      </div>
    </SidebarShell>
  );
}
