import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useSyncExternalStore } from "react";

import { showDockChat } from "#/lib/assistant-dock.ts";
import { runningKey, subscribeRuns } from "#/lib/chat-runs.ts";
import { listConversationsFn } from "#/server/conversations.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";

/** The dock header's title: the current chat's name, opening a menu of every
 * saved chat (the same list as the Assistant page sidebar). */
export function DockChatSwitcher({ chatId }: { chatId: string }) {
  const list = useQuery({ queryKey: ["conversations"], queryFn: () => listConversationsFn() });
  const runKey = useSyncExternalStore(subscribeRuns, runningKey, () => "");
  const running = new Set(runKey ? runKey.split(",") : []);
  const title = list.data?.find((c) => c.id === chatId)?.title ?? "New chat";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch chat"
          className="min-w-0 flex-1 justify-start px-2 font-semibold"
        >
          <span className="min-w-0 truncate">{title}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-80 max-w-[calc(100vw-2rem)]">
        {(list.data ?? []).map((conv) => (
          <DropdownMenuItem
            key={conv.id}
            onSelect={() => showDockChat(conv.id)}
            className={conv.id === chatId ? "bg-accent" : ""}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${
                running.has(conv.id) ? "bg-primary" : "bg-transparent"
              }`}
            />
            <span className="min-w-0 truncate">{conv.title ?? "Untitled"}</span>
          </DropdownMenuItem>
        ))}
        {list.isPending && <div className="px-2 py-2 text-sm text-muted-foreground">Loading…</div>}
        {list.isSuccess && list.data.length === 0 && (
          <div className="px-2 py-2 text-sm text-muted-foreground">No saved chats yet</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
