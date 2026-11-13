import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2, Plus, X } from "lucide-react";
import { useEffect } from "react";

import { ChatPane } from "#/components/assistant/chat-view.tsx";
import { ContextChip } from "#/components/assistant/context-chip.tsx";
import { DockChatSwitcher } from "#/components/assistant/dock-chat-switcher.tsx";
import { NAV_LINKS, navLinkActive, SETTINGS_LINK } from "#/components/nav-links.ts";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { closeDock, newDockChat } from "#/lib/assistant-dock.ts";
import { subscribeRuns } from "#/lib/chat-runs.ts";
import { IconProvider } from "#/lib/icons";
import { useFocusedEntity, type PageContextRecord } from "#/lib/page-context.ts";

const pageName = (pathname: string) =>
  [...NAV_LINKS, SETTINGS_LINK].find((l) => navLinkActive(l, pathname))?.label ?? "Home";

/** The assistant dock's contents (lazy-loaded by AssistantDockHost): a header
 * with the chat switcher, new chat, open-in-full-page and close, over the same
 * ChatPane the Assistant page renders. Sends carry the current page and its
 * focused entity. */
export function AssistantDock({ chatId }: { chatId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const entity = useFocusedEntity();
  const record: PageContextRecord = {
    path: pathname,
    page: pageName(pathname),
    ...(entity ? { entity } : {}),
  };
  // the server saves and titles chats; refresh the switcher when a run moves
  useEffect(
    () => subscribeRuns(() => void qc.invalidateQueries({ queryKey: ["conversations"] })),
    [qc],
  );

  return (
    <IconProvider>
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-card pr-1 pl-1">
        <DockChatSwitcher chatId={chatId} />
        <Tooltip content="New chat" label>
          <Button variant="ghost" size="icon" onClick={newDockChat}>
            <Plus />
          </Button>
        </Tooltip>
        <Tooltip content="Open in full page" label>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              closeDock();
              void navigate({ to: "/assistant", search: { c: chatId } });
            }}
          >
            <Maximize2 />
          </Button>
        </Tooltip>
        <Tooltip content="Close" label>
          <Button variant="ghost" size="icon" onClick={closeDock}>
            <X />
          </Button>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1">
        <ChatPane
          key={chatId}
          id={chatId}
          active
          dock={{ record, chip: entity ? <ContextChip entity={entity} /> : null }}
        />
      </div>
    </IconProvider>
  );
}
