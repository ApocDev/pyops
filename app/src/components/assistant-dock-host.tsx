import { lazy, Suspense } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ASK_HOTKEY, toggleDock, useDock } from "../lib/assistant-dock";
import { useHotkey } from "../lib/hotkeys";
import { Skeleton } from "#/components/ui/skeleton.tsx";

// The chat runtime (AI SDK, markdown, transcript UI) loads on first open only.
const AssistantDock = lazy(() =>
  import("./assistant/assistant-dock").then((m) => ({ default: m.AssistantDock })),
);

/** Root-mounted frame for the assistant dock: a 440px column beside the page
 * from `lg` up (the page narrows, nothing is covered), a right-hand overlay on
 * tablets, and a full-screen sheet on phones. Not shown on the Assistant page. */
export function AssistantDockHost() {
  const { open, chatId } = useDock();
  const onAssistant = useRouterState({ select: (s) => s.location.pathname === "/assistant" });
  useHotkey(ASK_HOTKEY, toggleDock, {
    description: "Ask the assistant about this page",
    allowInInputs: true,
    enabled: !onAssistant,
  });
  if (!open || onAssistant) return null;
  return (
    <aside
      aria-label="Assistant"
      className="fixed inset-0 z-40 flex flex-col border-border bg-background sm:left-auto sm:w-[440px] sm:border-l sm:shadow-lg lg:static lg:z-auto lg:shrink-0 lg:shadow-none"
    >
      <Suspense
        fallback={
          <div className="flex flex-col gap-3 p-3">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
      >
        <AssistantDock chatId={chatId} />
      </Suspense>
    </aside>
  );
}
