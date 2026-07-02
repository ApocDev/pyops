import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Flame,
  FlaskConical,
  GitBranch,
  Grid2x2,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Markdown from "react-markdown";
import { Popover } from "radix-ui";
import remarkGfm from "remark-gfm";

import { Icon, IconProvider } from "#/lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { ItemHover, RecipeHover } from "#/lib/recipe-card";
import { formatRate } from "#/lib/format";
import {
  aiConfigFn,
  classifyRefFn,
  saveBlockFn,
  setAiConfigFn,
  setBlockRateFn,
} from "#/server/factorio";
import {
  activeAssistantRunsFn,
  conversationModelFn,
  conversationTokenStatusFn,
  deleteConversationFn,
  listConversationsFn,
  renameConversationFn,
  setConversationModelFn,
  setConversationReasoningEffortFn,
} from "#/server/conversations.ts";
import {
  compactChat,
  dropChat,
  branchChat,
  getChat,
  peekChat,
  retryInChat,
  runningKey,
  sendInChat,
  stopInChat,
  subscribeRuns,
  type ChatInstance,
} from "#/lib/chat-store.ts";

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
  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    dropChat(id);
    await deleteConversationFn({ data: id });
    setOpenIds((ids) => ids.filter((x) => x !== id));
    if (id === selected) newChat();
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
            <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Chats
            </span>
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
                  title={running.has(conv.id) ? "running…" : undefined}
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
                  title="rename"
                  className="hidden text-muted-foreground group-hover:inline-flex hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void remove(conv.id)}
                  title="delete"
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
              <div className="px-2 py-2 text-sm text-muted-foreground">no saved chats yet</div>
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
      </div>
    </SidebarShell>
  );
}

/** Resolves the conversation's live Chat from the store (which loads history +
 * keeps it running across navigation), then renders the view. */
function ChatPane({ id, active }: { id: string; active: boolean }) {
  const [chat, setChat] = useState(() => peekChat(id));
  useEffect(() => {
    let alive = true;
    void getChat(id).then((c) => alive && setChat(c));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!chat) {
    return active ? <ChatPaneSkeleton /> : null;
  }
  return <ChatView chat={chat} active={active} />;
}

/** Loading placeholder for a chat pane: approximates the header bar + a few
 * message bubbles so the surface never renders blank. */
function ChatPaneSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b border-border bg-card px-6 py-2">
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-6 py-4">
          <div className="flex justify-end">
            <Skeleton className="h-10 w-1/2" />
          </div>
          <Skeleton className="h-24 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-10 w-1/3" />
          </div>
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Draft a block: 250/s iron-plate using the high-tier endgame chain.",
  "How do I make iron plate at high tier? Trace the chain.",
  "Is pressured-air something I build or import?",
  "What can I do with tailings?",
];

const MODEL_SHORTLIST = [
  "~anthropic/claude-sonnet-latest",
  "~anthropic/claude-opus-latest",
  "~google/gemini-flash-latest",
  "~moonshotai/kimi-latest",
  "~openai/gpt-latest",
  "~openai/gpt-mini-latest",
  "moonshotai/kimi-k2.7-code",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "z-ai/glm-5.2",
  "openrouter/auto",
];

function ChatView({ chat, active }: { chat: ChatInstance; active: boolean }) {
  // Bind to the store-owned Chat. Persistence + titling live in the store (wired to
  // the Chat's onFinish), so a run that finishes while this view is unmounted still
  // saves. We only render + send here.
  const { messages, status, error } = useChat({ chat, resume: true });
  const qc = useQueryClient();
  // Surface a missing OpenRouter key up front — otherwise a send just fails silently.
  const aiConfig = useQuery({ queryKey: ["aiConfig"], queryFn: () => aiConfigFn() });
  const noKey = aiConfig.data ? !aiConfig.data.keyStored && !aiConfig.data.keyFromEnv : false;
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const navigate = useNavigate();
  const model = useQuery({
    queryKey: ["conversation-model", chat.id],
    queryFn: () => conversationModelFn({ data: chat.id }),
  });
  const tokenStatus = useQuery({
    queryKey: ["token-status", chat.id],
    queryFn: () => conversationTokenStatusFn({ data: chat.id }),
  });
  const [compacting, setCompacting] = useState(false);
  // Refresh the gauge whenever a turn finishes (real token counts just landed).
  useEffect(() => {
    if (!busy) void qc.invalidateQueries({ queryKey: ["token-status", chat.id] });
  }, [busy, chat.id, qc]);
  const compactNow = async () => {
    if (busy || compacting) return;
    setCompacting(true);
    try {
      await compactChat(chat.id);
      await qc.invalidateQueries({ queryKey: ["token-status", chat.id] });
    } finally {
      setCompacting(false);
    }
  };
  const saveModel = async (value: string) => {
    await setConversationModelFn({ data: { id: chat.id, model: value || null } });
    await qc.invalidateQueries({ queryKey: ["conversation-model", chat.id] });
    await qc.invalidateQueries({ queryKey: ["conversations"] });
  };
  const saveReasoningEffort = async (value: string) => {
    await setConversationReasoningEffortFn({
      data: { id: chat.id, reasoningEffort: value || null },
    });
    await qc.invalidateQueries({ queryKey: ["conversation-model", chat.id] });
    await qc.invalidateQueries({ queryKey: ["conversations"] });
  };
  const makeDefaultModel = async (value: string) => {
    const picked = value.trim();
    if (!picked) return;
    await setAiConfigFn({ data: { model: picked } });
    await qc.invalidateQueries({ queryKey: ["conversation-model", chat.id] });
    await qc.invalidateQueries({ queryKey: ["aiConfig"] });
  };

  // A turn that ended on tool calls with no text answer / block draft — the agent
  // stopped short, or the run was interrupted (reload/stop). Offer to resume.
  const last = messages[messages.length - 1];
  const incompleteTurn =
    !busy &&
    last?.role === "assistant" &&
    last.parts.some((p: any) => isToolPart(p)) &&
    !last.parts.some(
      (p: any) =>
        (p.type === "text" && p.text.trim()) ||
        ((p.type === "tool-submitBlock" ||
          p.type === "tool-submitPlan" ||
          p.type === "tool-reviseBlock") &&
          p.state === "output-available"),
    );

  // Follow the stream: keep pinned to the bottom as content arrives, but don't
  // fight a user who has scrolled up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages, status, active]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    void sendInChat(chat.id, t, editingId ?? undefined);
    setInput("");
    setEditingId(null);
  };

  const edit = (message: ChatMessage) => {
    setEditingId(message.id);
    setInput(textOfMessage(message));
  };

  const branch = async (messageId: string) => {
    const id = await branchChat(chat.id, messageId);
    if (id) await navigate({ to: "/assistant", search: { c: id } });
  };

  return (
    <div className={`h-full min-w-0 flex-1 flex-col ${active ? "flex" : "hidden"}`}>
      <div className="flex shrink-0 items-center border-b border-border bg-card px-6 py-2">
        <div className="text-sm font-semibold text-foreground">PyOps Assistant</div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-6 py-4">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-muted-foreground">
              <div className="text-lg font-semibold text-foreground">PyOps Assistant</div>
              <p className="mx-auto mt-2 max-w-xl text-sm">
                Ask about Pyanodons production chains, recipes, tiers, and what to import vs. build
                — or have it draft a full block. Hover any item or recipe for details.
              </p>
              <div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    onClick={() => submit(s)}
                    className="h-auto justify-start px-3 py-2 text-left font-normal whitespace-normal"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              busy={busy}
              onEdit={m.role === "user" ? () => edit(m) : undefined}
              onRetry={m.role === "assistant" ? () => void retryInChat(chat.id, m.id) : undefined}
              onBranch={() => void branch(m.id)}
            />
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
              Assistant is working…
            </div>
          )}

          {incompleteTurn && (
            <Callout
              tone="warning"
              action={
                <Button
                  size="sm"
                  onClick={() =>
                    submit("Continue from where you left off and give the final answer.")
                  }
                >
                  Continue
                </Button>
              }
            >
              The assistant stopped without a final answer (interrupted, or it ran out of steps).
            </Callout>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex shrink-0 items-end gap-2 border-t border-border bg-card px-6 py-3"
      >
        <div className="mx-auto w-full max-w-6xl">
          {noKey && (
            <Callout tone="warning" className="mb-1.5">
              No OpenRouter API key set — the assistant can&apos;t respond. Add one in{" "}
              <Link to="/settings" className="font-medium underline">
                Settings → Assistant
              </Link>
              , or set the <code className="font-mono">OPENROUTER_API_KEY</code> env var.
            </Callout>
          )}
          {error && (
            <Callout tone="destructive" className="mb-1.5">
              {error.message?.trim() || "The assistant request failed. See the server log."}
            </Callout>
          )}
          {editingId && (
            <div className="mb-1.5 flex items-center gap-2 text-sm text-warning">
              <span>Editing an earlier message; sending will replace it and retry from there.</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setEditingId(null);
                  setInput("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                Cancel
              </Button>
            </div>
          )}
          <div className="border border-border bg-background focus-within:border-primary">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={2}
              placeholder="Ask about a recipe or chain…  (Enter to send, Shift+Enter for newline)"
              className="max-h-48 min-h-[3.5rem] resize-none border-0 bg-transparent px-3 py-2.5 leading-relaxed focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
              <ContextGauge
                status={tokenStatus.data}
                busy={busy}
                compacting={compacting}
                onCompact={() => void compactNow()}
              />
              <ModelMenu
                model={model.data}
                disabled={busy}
                onSaveModel={(value) => void saveModel(value)}
                onMakeDefault={(value) => void makeDefaultModel(value)}
              />
              <ReasoningMenu
                model={model.data}
                disabled={busy}
                onSaveReasoning={(value) => void saveReasoningEffort(value)}
              />
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => void stopInChat(chat.id)}
                  title="Stop generating"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-lg"
                  disabled={!input.trim()}
                  title={editingId ? "Resend" : "Send"}
                  className="ml-auto"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

type TokenStatus = {
  usedTokens: number;
  contextWindow: number;
  ratio: number;
  estimated: boolean;
  modelId: string | null;
  resolvedModel: string;
  messageCount: number;
};

/** A small filling ring showing how much of the model's context window the
 * conversation occupies. The % sits in the middle; clicking compacts older
 * messages now. Green → amber → red as it fills. */
function ContextGauge({
  status,
  busy,
  compacting,
  onCompact,
}: {
  status: TokenStatus | undefined;
  busy: boolean;
  compacting: boolean;
  onCompact: () => void;
}) {
  const ratio = Math.min(1, Math.max(0, status?.ratio ?? 0));
  const pct = Math.round(ratio * 100);
  const size = 34;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ringColor =
    ratio >= 0.85 ? "text-destructive" : ratio >= 0.6 ? "text-warning" : "text-success";
  const used = status?.usedTokens ?? 0;
  const window = status?.contextWindow ?? 0;
  const title = status
    ? `${used.toLocaleString()} / ${window.toLocaleString()} tokens · ${pct}% of context\n` +
      `${status.estimated ? "estimated (no completed turn yet)" : "measured from the last turn"}` +
      `\nmodel: ${status.modelId ?? status.resolvedModel}\n\nClick to compact older messages now`
    : "context usage";
  return (
    <button
      type="button"
      onClick={onCompact}
      disabled={busy || compacting}
      title={title}
      aria-label={`Context ${pct}% full — click to compact`}
      className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted/60 disabled:opacity-50"
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="text-border"
          stroke="currentColor"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className={ringColor}
          stroke="currentColor"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground">
        {compacting ? <Loader2 className="size-3.5 animate-spin" /> : pct}
      </span>
    </button>
  );
}

type ModelInfo = {
  model: string;
  reasoningEffort: string;
  resolvedModel: string;
  modelFromEnv: boolean;
  modelFromConversation: boolean;
  reasoningEffortSupported: boolean;
  reasoningEfforts: string[];
  defaultModel: string;
};

const REASONING_LEVELS = ["low", "medium", "high"] as const;

/** The model + reasoning controls, tucked behind a gear popover so the header
 * stays clean. Replaces the old always-visible picker row. */
/** Internal-name → short label for the toolbar pill: drop the `~` alias marker
 * and the `author/` prefix, e.g. `~moonshotai/kimi-latest` → `kimi-latest`. */
const shortModel = (id: string) => id.replace(/^~/, "").split("/").pop() || id;

const popoverPanel = "z-50 w-80 border border-border bg-card p-2 text-foreground shadow-lg";

/** Model selector pill (name + chevron) → popover with the curated list, a
 * custom-id field, and make-default / clear. Opens upward (sits in the input bar). */
function ModelMenu({
  model,
  disabled,
  onSaveModel,
  onMakeDefault,
}: {
  model: ModelInfo | undefined;
  disabled: boolean;
  onSaveModel: (value: string) => void;
  onMakeDefault: (value: string) => void;
}) {
  const value = model?.model ?? "";
  const resolved = model?.resolvedModel ?? "";
  const defaultModel = model?.defaultModel ?? "";
  const envOverride = !!model?.modelFromEnv;

  const [draft, setDraft] = useState(value);
  const [customOpen, setCustomOpen] = useState(() => !!value && !MODEL_SHORTLIST.includes(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = !draft ? "__default__" : MODEL_SHORTLIST.includes(draft) ? draft : "__custom__";
  const activeModel = draft.trim() || resolved;
  useEffect(() => {
    setDraft(value);
    setCustomOpen(!!value && !MODEL_SHORTLIST.includes(value));
  }, [value]);

  const fieldClass =
    "h-8 w-full border border-input bg-background px-2 text-sm outline-none focus:border-primary disabled:opacity-50";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          title={`Model: ${resolved || "…"}${envOverride ? " (PYOPS_AGENT_MODEL env override)" : ""}`}
          className="text-muted-foreground"
        >
          <span className="max-w-[6rem] truncate text-foreground md:max-w-[12rem]">
            {resolved ? shortModel(resolved) : "model"}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} className={`${popoverPanel} p-3`}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model
          </div>
          <select
            value={selected}
            disabled={envOverride}
            onChange={(e) => {
              if (e.target.value === "__default__") {
                setCustomOpen(false);
                setDraft("");
                onSaveModel("");
              } else if (e.target.value === "__custom__") {
                setCustomOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              } else {
                setCustomOpen(false);
                setDraft(e.target.value);
                onSaveModel(e.target.value);
              }
            }}
            className={fieldClass}
          >
            <option value="__default__">Default · {resolved || defaultModel}</option>
            {MODEL_SHORTLIST.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">Custom OpenRouter id…</option>
          </select>
          {customOpen && !envOverride && (
            <Input
              ref={inputRef}
              value={draft}
              placeholder={defaultModel || resolved}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onSaveModel(draft.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="mt-2"
            />
          )}
          {envOverride ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              <code>PYOPS_AGENT_MODEL</code> is set — env wins for every chat.
            </p>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!activeModel}
                onClick={() => onMakeDefault(activeModel)}
                className="flex-1 text-muted-foreground hover:text-foreground"
              >
                Make default
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!value}
                onClick={() => {
                  setDraft("");
                  setCustomOpen(false);
                  onSaveModel("");
                }}
                className="flex-1 text-muted-foreground"
              >
                Clear override
              </Button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Reasoning-effort pill (brain + level) → a small menu of Auto / Low / Medium /
 * High, greying levels the model doesn't support. Opens upward. */
function ReasoningMenu({
  model,
  disabled,
  onSaveReasoning,
}: {
  model: ModelInfo | undefined;
  disabled: boolean;
  onSaveReasoning: (value: string) => void;
}) {
  const supported = !!model?.reasoningEffortSupported;
  const current = supported ? (model?.reasoningEffort ?? "") : "";
  // Levels the server accepts (low/medium/high), narrowed to what the model
  // advertises when the catalogue lists them.
  const allowed: string[] = model?.reasoningEfforts?.length
    ? REASONING_LEVELS.filter((l) => model.reasoningEfforts.includes(l))
    : [...REASONING_LEVELS];
  const options = [
    { value: "", label: "Auto", hint: "model default" },
    ...REASONING_LEVELS.map((l) => ({
      value: l,
      label: l[0].toUpperCase() + l.slice(1),
      hint: "",
    })),
  ];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          title={
            supported
              ? "Reasoning effort"
              : "This model doesn’t advertise OpenRouter reasoning effort"
          }
          className="text-muted-foreground"
        >
          {current ? <Brain className="size-3.5" /> : <Zap className="size-3.5" />}
          <span className="text-foreground">
            {current ? current[0].toUpperCase() + current.slice(1) : "Auto"}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} className={`${popoverPanel} w-52`}>
          {options.map((opt) => {
            const isLevel = opt.value !== "";
            const optDisabled = isLevel && (!supported || !allowed.includes(opt.value));
            const isCurrent = opt.value === current;
            return (
              <Popover.Close asChild key={opt.value || "auto"}>
                <button
                  type="button"
                  disabled={optDisabled}
                  onClick={() => !optDisabled && onSaveReasoning(opt.value)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent ${
                    isCurrent ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {opt.value === "" ? (
                    <Zap className="size-4 shrink-0" />
                  ) : (
                    <Brain className="size-4 shrink-0" />
                  )}
                  <span className="flex-1">{opt.label}</span>
                  {opt.hint && <span className="text-xs text-muted-foreground">{opt.hint}</span>}
                  {isCurrent && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              </Popover.Close>
            );
          })}
          {!supported && (
            <p className="px-2 pt-1.5 text-sm text-muted-foreground">
              Levels need a model that supports reasoning effort.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type ChatMessage = ReturnType<typeof useChat>["messages"][number];

function Message({
  message,
  busy,
  onEdit,
  onRetry,
  onBranch,
}: {
  message: ChatMessage;
  busy: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
  onBranch: () => void;
}) {
  const isUser = message.role === "user";
  const compaction = compactionData(message);
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "group/message space-y-2 px-3 py-2 text-sm " +
          (isUser ? "max-w-[80%] bg-primary/15 text-foreground" : "w-full bg-card text-foreground")
        }
      >
        {compaction ? (
          <CompactionNotice message={message} compaction={compaction} />
        ) : (
          renderParts(message.parts, isUser)
        )}
        <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          {onEdit && (
            <IconButton title="edit and resend" disabled={busy} onClick={onEdit}>
              <Pencil className="size-3.5" />
            </IconButton>
          )}
          {onRetry && (
            <IconButton title="retry this answer" disabled={busy} onClick={onRetry}>
              <RefreshCcw className="size-3.5" />
            </IconButton>
          )}
          <IconButton title="branch from here" disabled={busy} onClick={onBranch}>
            <GitBranch className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

type ArchivedMessage = { id: string; role: string; parts: string };
type CompactionData = {
  version: 1;
  compactedAt: string;
  model: string;
  originalCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  originals: ArchivedMessage[];
};

function compactionData(message: ChatMessage): CompactionData | null {
  if (message.role !== "system") return null;
  const part = message.parts.find((p: any) => p.type === "data-compaction") as
    | { data?: CompactionData }
    | undefined;
  return part?.data ?? null;
}

function textParts(parts: any[]): string {
  return parts
    .filter((p) => p?.type === "text" || p?.type === "reasoning")
    .map((p) => p.text ?? "")
    .join("\n\n")
    .trim();
}

function parseStoredParts(parts: string): any[] {
  try {
    const parsed = JSON.parse(parts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function CompactionNotice({
  message,
  compaction,
}: {
  message: ChatMessage;
  compaction: CompactionData;
}) {
  const summary = textParts(message.parts).replace(
    /^Earlier conversation summary\. Use this as context for the rest of the chat:\n\n/,
    "",
  );
  return (
    <details className="border border-warning/30 bg-warning/5 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-muted-foreground">
        Earlier conversation summarized · {compaction.originalCount} messages ·{" "}
        {compaction.estimatedTokensBefore.toLocaleString()} →{" "}
        {compaction.estimatedTokensAfter.toLocaleString()} est. tokens
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <Prose text={summary} />
        <details className="border border-border/60 bg-background/50">
          <summary className="cursor-pointer select-none px-2 py-1 text-sm text-muted-foreground">
            View original messages
          </summary>
          <div className="max-h-96 space-y-2 overflow-auto px-2 py-2">
            {compaction.originals.map((original) => {
              const parts = parseStoredParts(original.parts);
              const text = textParts(parts);
              return (
                <details key={original.id} className="border border-border/60 p-2 text-sm">
                  <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                    {original.role}
                    {text ? ` · ${text.replace(/\s+/g, " ").slice(0, 120)}` : ""}
                  </summary>
                  {text && <div className="mt-2 whitespace-pre-wrap">{text}</div>}
                  <pre className="mt-2 max-h-80 overflow-auto bg-background p-2 text-xs text-muted-foreground">
                    {JSON.stringify(parts, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>
        </details>
      </div>
    </details>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground"
    >
      {children}
    </Button>
  );
}

function textOfMessage(message: ChatMessage) {
  return message.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text ?? "")
    .join("\n\n")
    .trim();
}

const isToolPart = (part: any) =>
  (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
  !(
    (part.type === "tool-submitBlock" ||
      part.type === "tool-submitPlan" ||
      part.type === "tool-reviseBlock") &&
    part.state === "output-available"
  );

// Per-step machinery that sits between tool calls. Reasoning is rendered below.
const isMachineryPart = (part: any) => part.type === "step-start";

/** Render a message's parts, collapsing each run of consecutive tool calls into a
 * single expandable "N tool calls" group so the transcript isn't dominated by
 * machinery most readers don't care about. Step-start parts between tool calls
 * don't break the run; rendered reasoning, text answers, and block drafts do. */
function renderParts(parts: ChatMessage["parts"], isUser: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let run: { part: any; i: number }[] = [];
  const flush = () => {
    if (run.length === 1) out.push(<ToolCall key={`t${run[0].i}`} part={run[0].part} />);
    else if (run.length > 1)
      out.push(<ToolCallGroup key={`tg${run[0].i}`} parts={run.map((r) => r.part)} />);
    run = [];
  };
  parts.forEach((part, i) => {
    if (isToolPart(part)) {
      run.push({ part, i });
      return;
    }
    // keep a run intact across step boundaries / reasoning between tool calls
    if (isMachineryPart(part)) return;
    flush();
    if (part.type === "text") {
      out.push(
        isUser ? (
          <div key={i} className="whitespace-pre-wrap leading-relaxed">
            {part.text}
          </div>
        ) : (
          <Prose key={i} text={part.text} />
        ),
      );
    } else if (part.type === "reasoning") {
      out.push(<ReasoningBlock key={i} text={part.text ?? ""} state={part.state} />);
    } else if (part.type === "tool-submitBlock" && part.state === "output-available") {
      out.push(<BlockDraft key={i} draft={part.output as Draft} />);
    } else if (part.type === "tool-reviseBlock" && part.state === "output-available") {
      out.push(<BlockUpdate key={i} draft={part.output as Draft} />);
    } else if (part.type === "tool-submitPlan" && part.state === "output-available") {
      out.push(<PlanDraft key={i} plan={part.output as PlanDraftData} />);
    }
  });
  flush();
  return out;
}

function ReasoningBlock({ text, state }: { text: string; state?: string }) {
  if (!text.trim()) return null;
  return (
    <details className="border border-info/30 bg-info/5 text-sm">
      <summary className="cursor-pointer select-none px-2 py-1 text-muted-foreground">
        <span className={`inline-flex ${state === "streaming" ? "text-warning/90" : "text-info"}`}>
          {state === "streaming" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </span>{" "}
        reasoning
      </summary>
      <div className="whitespace-pre-wrap px-2 py-1 text-muted-foreground">{text}</div>
    </details>
  );
}

/* ── Rich item/recipe reference ───────────────────────────────────────────── */

/** A bare name from the agent → icon + display, wrapped in the right hover.
 * Unknown names (tool names, prose) fall back to a plain <code>. */
function Ref({ name, prefer }: { name: string; prefer?: "recipe" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ref", name, prefer],
    queryFn: () => classifyRefFn({ data: { name, prefer } }),
    staleTime: 5 * 60_000,
  });
  if (isLoading || data === undefined)
    return <code className="bg-muted/60 px-1 py-0.5 font-mono text-[0.85em]">{name}</code>;
  if (data === null)
    return <code className="bg-muted/60 px-1 py-0.5 font-mono text-[0.85em]">{name}</code>;

  // In a recipe list the names are recipes by construction (even iron-plate, which
  // also resolves as an item) — honour the caller's preference.
  const kind: "item" | "fluid" | "recipe" = prefer === "recipe" ? "recipe" : data.kind;
  const chip = (
    <span className="inline-flex items-center gap-1 bg-muted/60 px-1 py-0.5 align-middle font-mono text-[0.85em] hover:bg-muted">
      <Icon kind={kind} name={name} size="sm" noHover />
      <span>{data.display}</span>
    </span>
  );
  return kind === "recipe" ? (
    <RecipeHover name={name} className="inline-block cursor-help">
      {chip}
    </RecipeHover>
  ) : (
    <ItemHover name={name} kind={kind} className="inline-block cursor-help">
      {chip}
    </ItemHover>
  );
}

/** Markdown with backtick spans upgraded to rich item/recipe refs. */
function Prose({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // a div, not <p>: rich refs use a block-ish hover wrapper that would be
          // invalid (and a hydration error) nested inside a <p>.
          p: (props) => <div {...props} className="my-2 first:mt-0 last:mb-0" />,
          ul: (props) => <ul {...props} className="my-2 list-disc space-y-1 pl-5" />,
          ol: (props) => <ol {...props} className="my-2 list-decimal space-y-1 pl-5" />,
          li: (props) => <li {...props} className="leading-relaxed" />,
          h1: (props) => <h1 {...props} className="mb-1 mt-3 text-base font-semibold" />,
          h2: (props) => <h2 {...props} className="mb-1 mt-3 text-base font-semibold" />,
          h3: (props) => <h3 {...props} className="mb-1 mt-2 text-sm font-semibold" />,
          strong: (props) => <strong {...props} className="font-semibold text-foreground" />,
          hr: () => <hr className="my-3 border-border" />,
          pre: (props) => (
            <pre {...props} className="my-2 overflow-auto bg-background p-2 text-sm leading-snug" />
          ),
          table: (props) => <table {...props} className="my-2 w-full border-collapse text-sm" />,
          th: (props) => <th {...props} className="border border-border px-2 py-1 text-left" />,
          td: (props) => <td {...props} className="border border-border px-2 py-1" />,
          a: (props) => <a {...props} className="text-primary underline" />,
          code(props) {
            const { children, className } = props;
            // fenced/multiline blocks keep <code>; inline single-token spans become
            // refs. children is the code text — only a plain string can be a ref.
            if (typeof children !== "string") return <code className={className}>{children}</code>;
            const raw = children.replace(/\n$/, "");
            if (className || raw.includes("\n") || /\s{2,}/.test(raw))
              return <code className={className}>{children}</code>;
            return <Ref name={raw} />;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

/* ── Block draft preview ──────────────────────────────────────────────────── */

type GoodRate = { good: string; rate?: number | null };
type Draft = {
  name?: string;
  target: string;
  targetDisplay?: string;
  rate: number;
  recipes: string[];
  modules?: Record<string, string[]>;
  machines?: Record<string, string>;
  notes?: string | null;
  powerW?: number | null;
  heatW?: number | null;
  imports?: string[];
  importsFromBlocks?: {
    good: string;
    rate?: number | null;
    fromBlock: { id: number; name: string }[];
  }[];
  importsExternal?: string[];
  subBlocksNeeded?: GoodRate[];
  byproducts?: GoodRate[];
  rates?: Record<string, number>;
  turd?: {
    ok: boolean;
    conflicts?: {
      master: string;
      masterDisplay: string;
      choices: { sub: string; choice: string; recipes: string[] }[];
    }[];
    selections?: {
      master: string;
      masterDisplay: string;
      requiredChoice: string;
      current: string | null;
      action: "already-selected" | "pick" | "switch";
    }[];
  };
  invalid?: string[];
  // Set when this draft is a reviseBlock proposal (resize an existing block)
  // rather than a new block. `updateBlockId` is the block to apply the new rate to.
  kind?: "update";
  updateBlockId?: number;
  blockName?: string;
  oldRate?: number;
  missing?: boolean;
};

type PlanDraftData = {
  ok: boolean;
  title: string;
  objective: string;
  buildingMaterialsIncluded: boolean;
  notes?: string | null;
  blocks: Draft[];
  updates?: Draft[];
  turd?: Draft["turd"];
  invalid?: string[];
};

const fmtRate = (r?: number | null) => (r != null ? formatRate(r) : "");

function refRow(label: ReactNode, items: string[] | undefined, prefer?: "recipe", warn?: boolean) {
  return items && items.length ? (
    <div className="mt-2.5">
      <div
        className={`flex items-center gap-1 text-xs uppercase tracking-wide ${warn ? "text-destructive" : "text-muted-foreground"}`}
      >
        {label}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((g) => (
          <Ref key={g} name={g} prefer={prefer} />
        ))}
      </div>
    </div>
  ) : null;
}

// chips with a per-good rate suffix (sized to demand)
function rateRow(label: ReactNode, entries: GoodRate[] | undefined) {
  return entries && entries.length ? (
    <div className="mt-2.5">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {entries.map((e) => (
          <span key={e.good} className="inline-flex items-center gap-1">
            <Ref name={e.good} />
            {e.rate != null && (
              <span className="text-xs text-muted-foreground">{fmtRate(e.rate)}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  ) : null;
}

/** The shared body of a block draft / update card: recipes, imports, sub-blocks,
 * byproducts, TURD, invalid recipes — everything below the header + action button. */
function DraftRows({ draft }: { draft: Draft }) {
  const externalImports: GoodRate[] = (draft.importsExternal ?? draft.imports ?? []).map((g) => ({
    good: g,
    rate: draft.rates?.[g],
  }));
  return (
    <>
      {refRow(`${draft.recipes.length} recipes`, draft.recipes, "recipe")}
      {rateRow("imports (external)", externalImports)}
      {draft.importsFromBlocks && draft.importsFromBlocks.length > 0 && (
        <div className="mt-2.5">
          <div className="text-xs uppercase tracking-wide text-info/80">
            reuse from existing blocks
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {draft.importsFromBlocks.map((i) => (
              <span key={i.good} className="inline-flex items-center gap-1">
                <Ref name={i.good} />
                <span className="text-xs text-muted-foreground">
                  {i.rate != null && `${fmtRate(i.rate)} `}←{" "}
                  {i.fromBlock.map((b) => `#${b.id}`).join(", ")}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      {rateRow(
        <>
          <Grid2x2 className="size-3.5" /> suggested sub-blocks to draft next (sized to demand)
        </>,
        draft.subBlocksNeeded,
      )}
      {rateRow("byproducts (must be routed — hard mode can't void)", draft.byproducts)}

      {draft.turd?.conflicts && draft.turd.conflicts.length > 0 && (
        <div className="mt-2.5">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-destructive">
            <AlertTriangle className="size-3.5" /> TURD conflicts (infeasible — one choice per
            master)
          </div>
          {draft.turd.conflicts.map((c) => (
            <div key={c.master} className="mt-1 text-sm">
              <span className="inline-flex items-center gap-1 text-destructive">
                <FlaskConical className="size-3.5" /> {c.masterDisplay}
              </span>
              : {c.choices.map((ch) => ch.choice).join(" vs ")}
            </div>
          ))}
        </div>
      )}
      {draft.turd?.selections && draft.turd.selections.length > 0 && (
        <div className="mt-2.5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            TURD selections this block needs
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {draft.turd.selections.map((sel) => (
              <span
                key={sel.master}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-sm ${
                  sel.action === "switch"
                    ? "bg-warning/15 text-warning"
                    : sel.action === "pick"
                      ? "bg-info/15 text-info"
                      : "bg-success/15 text-success/90"
                }`}
                title={`${sel.action}${sel.current ? ` (currently: ${sel.current})` : ""}`}
              >
                <FlaskConical className="size-3.5" /> {sel.masterDisplay} › {sel.requiredChoice}
                {sel.action === "switch" && (
                  <>
                    <AlertTriangle className="size-3.5" /> switch
                  </>
                )}
                {sel.action === "already-selected" && <Check className="size-3.5" />}
              </span>
            ))}
          </div>
        </div>
      )}
      {refRow(
        <>
          <AlertTriangle className="size-3.5" /> invalid recipe names
        </>,
        draft.invalid,
        undefined,
        true,
      )}
    </>
  );
}

function BlockDraft({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle");

  const create = async () => {
    setStatus("creating");
    try {
      const { id } = await saveBlockFn({
        data: {
          name: `${draft.targetDisplay ?? draft.target} (drafted)`,
          data: {
            goals: [{ name: draft.target, rate: draft.rate }],
            recipes: draft.recipes,
            ...(draft.modules && Object.keys(draft.modules).length
              ? { modules: draft.modules }
              : {}),
            ...(draft.machines && Object.keys(draft.machines).length
              ? { machines: draft.machines }
              : {}),
          },
        },
      });
      await navigate({ to: "/block/$id", params: { id: String(id) } });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Icon kind="item" name={draft.target} size="md" noTitle />
          <span>
            Proposed block:{" "}
            <span className="text-primary">{draft.targetDisplay ?? draft.target}</span>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              @ {draft.rate}/s
              {draft.powerW != null && draft.powerW > 0 && (
                <span className="inline-flex items-center gap-1">
                  {" · "}
                  <Zap className="size-3.5" /> {Math.round(draft.powerW / 1000)} kW
                </span>
              )}
              {draft.heatW != null && draft.heatW > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-warning"
                  title="heat doesn't travel — needs a local heat source"
                >
                  {" · "}
                  <Flame className="size-3.5" /> {Math.round(draft.heatW / 1000)} kW heat (local)
                </span>
              )}
            </span>
          </span>
        </div>
        <Button onClick={() => void create()} disabled={status === "creating"}>
          {status === "creating" ? "Creating…" : "Create block →"}
        </Button>
      </div>

      {draft.notes && <p className="mt-2 text-sm text-muted-foreground">{draft.notes}</p>}
      <DraftRows draft={draft} />

      {status === "error" && (
        <div className="mt-2 text-sm text-destructive">
          Couldn't create the block — see console.
        </div>
      )}
    </div>
  );
}

/** A reviseBlock proposal: re-solve an existing block at a new rate. The user
 * clicks Apply to persist the new rate (setBlockRateFn re-solves + saves). */
function BlockUpdate({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "applying" | "done" | "error">("idle");

  if (draft.missing || draft.updateBlockId == null) {
    return (
      <Callout tone="destructive">
        Couldn't find block #{draft.updateBlockId ?? "?"} to update — it may have been deleted.
      </Callout>
    );
  }
  const blockId = draft.updateBlockId;

  const apply = async () => {
    setStatus("applying");
    try {
      const res = await setBlockRateFn({ data: { blockId, rate: draft.rate } });
      if (!res.ok) throw new Error("not ok");
      setStatus("done");
      await navigate({ to: "/block/$id", params: { id: String(blockId) } });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Icon kind="item" name={draft.target} size="md" noTitle />
          <span>
            Resize block #{blockId}:{" "}
            <span className="text-warning">{draft.blockName ?? draft.targetDisplay}</span>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {draft.oldRate != null && (
                <>
                  <span className="line-through">{draft.oldRate}/s</span>
                  {" → "}
                </>
              )}
              <span className="font-medium text-foreground">{draft.rate}/s</span>
            </span>
          </span>
        </div>
        <Button
          onClick={() => void apply()}
          disabled={status === "applying" || status === "done"}
          className="border-warning/40 bg-warning/15 text-warning hover:bg-warning/25"
        >
          {status === "applying" ? (
            "Applying…"
          ) : status === "done" ? (
            <>
              Applied <Check className="size-3.5" />
            </>
          ) : (
            "Apply update →"
          )}
        </Button>
      </div>

      {draft.notes && <p className="mt-2 text-sm text-muted-foreground">{draft.notes}</p>}
      <DraftRows draft={draft} />

      {status === "error" && (
        <div className="mt-2 text-sm text-destructive">
          Couldn't apply the new rate — see console.
        </div>
      )}
    </div>
  );
}

function PlanDraft({ plan }: { plan: PlanDraftData }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [created, setCreated] = useState<{ id: number; name: string }[]>([]);

  const updates = (plan.updates ?? []).filter((u) => !u.missing && u.updateBlockId != null);

  const createAll = async () => {
    setStatus("creating");
    try {
      const made: { id: number; name: string }[] = [];
      for (const draft of plan.blocks) {
        const res = await saveBlockFn({
          data: {
            name: draft.name ?? `${draft.targetDisplay ?? draft.target} (drafted)`,
            data: { goals: [{ name: draft.target, rate: draft.rate }], recipes: draft.recipes },
          },
        });
        made.push(res);
      }
      // Apply the existing-block resizes (setBlockRateFn re-solves + persists each).
      for (const u of updates) {
        await setBlockRateFn({ data: { blockId: u.updateBlockId!, rate: u.rate } });
      }
      setCreated(made);
      setStatus("done");
      if (made[0]) await navigate({ to: "/block/$id", params: { id: String(made[0].id) } });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-primary">{plan.title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{plan.objective}</div>
        </div>
        <Button
          onClick={() => void createAll()}
          disabled={status === "creating" || status === "done" || plan.blocks.length === 0}
        >
          {status === "creating"
            ? "Applying…"
            : status === "done"
              ? `Done (${created.length})`
              : `Create ${plan.blocks.length} blocks${updates.length ? ` · resize ${updates.length}` : ""}`}
        </Button>
      </div>

      {plan.notes && <p className="mt-2 text-sm text-muted-foreground">{plan.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span className="border border-border/60 px-1.5 py-0.5">
          building materials {plan.buildingMaterialsIncluded ? "included" : "not included"}
        </span>
        {plan.invalid && plan.invalid.length > 0 && (
          <span className="border border-destructive/50 px-1.5 py-0.5 text-destructive">
            {plan.invalid.length} invalid recipes
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {plan.blocks.map((draft, index) => (
          <details key={`${draft.target}-${index}`} className="border border-border/60 p-2">
            <summary className="cursor-pointer select-none text-sm font-medium">
              {draft.name ?? draft.targetDisplay ?? draft.target}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                @ {draft.rate}/s · {draft.recipes.length} recipes
              </span>
            </summary>
            <PlanBlockPreview draft={draft} />
          </details>
        ))}
      </div>

      {updates.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-warning/80">
            resize existing blocks to meet demand
          </div>
          <div className="mt-1 space-y-2">
            {updates.map((u, index) => (
              <details
                key={`u-${u.updateBlockId}-${index}`}
                className="border border-warning/30 bg-warning/5 p-2"
              >
                <summary className="cursor-pointer select-none text-sm font-medium">
                  #{u.updateBlockId} {u.blockName ?? u.targetDisplay ?? u.target}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {u.oldRate != null && <span className="line-through">{u.oldRate}/s</span>} →{" "}
                    <span className="text-foreground">{u.rate}/s</span>
                  </span>
                </summary>
                <PlanBlockPreview draft={u} />
              </details>
            ))}
          </div>
        </div>
      )}

      {created.length > 0 && (
        <div className="mt-3 text-sm text-success">
          Created: {created.map((b) => `#${b.id} ${b.name}`).join(", ")}
        </div>
      )}
      {status === "error" && (
        <div className="mt-3 text-sm text-destructive">
          Couldn't create every block — see console.
        </div>
      )}
    </div>
  );
}

function PlanBlockPreview({ draft }: { draft: Draft }) {
  return (
    <div className="mt-2 space-y-2 text-sm">
      {draft.notes && <p className="text-muted-foreground">{draft.notes}</p>}
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">recipes</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {draft.recipes.map((r) => (
            <Ref key={r} name={r} prefer="recipe" />
          ))}
        </div>
      </div>
      {draft.importsExternal && draft.importsExternal.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            external imports
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {draft.importsExternal.map((g) => (
              <Ref key={g} name={g} />
            ))}
          </div>
        </div>
      )}
      {draft.subBlocksNeeded && draft.subBlocksNeeded.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            still suggested as sub-blocks
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {draft.subBlocksNeeded.map((entry) => (
              <span key={entry.good} className="inline-flex items-center gap-1">
                <Ref name={entry.good} />
                {entry.rate != null && (
                  <span className="text-xs text-muted-foreground">{fmtRate(entry.rate)}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Generic tool-call chip ───────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A collapsed run of consecutive tool calls — "✓ N tool calls" — that expands to
 * the individual (still individually expandable) calls. Collapsed by default. */
function ToolCallGroup({ parts }: { parts: any[] }) {
  const anyErr = parts.some((p) => p.state === "output-error");
  const allDone = parts.every((p) => p.state === "output-available" || p.state === "output-error");
  return (
    <details className="border border-border/60 bg-background/50 text-sm">
      <summary className="cursor-pointer select-none px-2 py-1 font-mono text-muted-foreground">
        <span
          className={`inline-flex ${
            anyErr ? "text-destructive" : allDone ? "text-success/90" : "text-warning/90"
          }`}
        >
          {anyErr ? (
            <X className="size-3.5" />
          ) : allDone ? (
            <Check className="size-3.5" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
        </span>{" "}
        {parts.length} tool calls
      </summary>
      <div className="space-y-1 px-2 py-1">
        {parts.map((p, i) => (
          <ToolCall key={i} part={p} />
        ))}
      </div>
    </details>
  );
}

function ToolCall({ part }: { part: any }) {
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
  const done = part.state === "output-available";
  const err = part.state === "output-error";
  return (
    <details className="border border-border/60 bg-background/50 text-sm">
      <summary className="cursor-pointer select-none px-2 py-1 font-mono text-muted-foreground">
        <span
          className={`inline-flex ${err ? "text-destructive" : done ? "text-success/90" : "text-warning/90"}`}
        >
          {err ? (
            <X className="size-3.5" />
          ) : done ? (
            <Check className="size-3.5" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
        </span>{" "}
        {name}
        {part.input ? ` (${Object.values(part.input).join(", ")})` : ""}
      </summary>
      {part.output != null && (
        <pre className="overflow-auto px-2 py-1 text-xs leading-snug text-muted-foreground">
          {JSON.stringify(part.output, null, 2)}
        </pre>
      )}
      {err && <div className="px-2 py-1 text-destructive">{String(part.errorText)}</div>}
    </details>
  );
}
