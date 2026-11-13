import { lazy, Suspense } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ASK_HOTKEY, closeDock, toggleDock, useDock } from "../lib/assistant-dock";
import { useHotkey } from "../lib/hotkeys";
import { useMediaQuery } from "../lib/use-media-query";
import { Sheet, SheetContent, SheetTitle } from "#/components/ui/sheet.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

// The chat runtime (AI SDK, markdown, transcript UI) loads on first open only.
const AssistantDock = lazy(() =>
  import("./assistant/assistant-dock").then((m) => ({ default: m.AssistantDock })),
);

/** The top-bar Ask button that is on screen (the full and folded bars each have one). */
const visibleAskButton = () =>
  [...document.querySelectorAll<HTMLElement>("[data-ask-button]")].find((b) => b.offsetParent);

/** Root-mounted frame for the assistant dock. From `lg` up it is a non-modal
 * 440px column beside the page (the page narrows, nothing is covered). Below
 * that it covers the page, so it is a modal sheet: a right-hand panel on
 * tablets, full screen on phones, with focus held inside and returned to the
 * Ask button on close. Not shown on the Assistant page. */
export function AssistantDockHost() {
  const { open, chatId } = useDock();
  const onAssistant = useRouterState({ select: (s) => s.location.pathname === "/assistant" });
  const beside = useMediaQuery("(min-width: 64rem)");
  useHotkey(ASK_HOTKEY, toggleDock, {
    description: "Ask the assistant about this page",
    allowInInputs: true,
    enabled: !onAssistant,
  });
  if (onAssistant) return null;

  const dock = (
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
  );

  if (!beside) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && closeDock()}>
        <SheetContent
          side="right"
          showClose={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const ask = visibleAskButton();
            if (!ask) return;
            e.preventDefault();
            ask.focus();
          }}
          className="w-full max-w-none bg-background backdrop-blur-none sm:w-[440px]"
        >
          <SheetTitle className="sr-only">Assistant</SheetTitle>
          {dock}
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      aria-label="Assistant"
      className="flex w-[440px] shrink-0 flex-col border-l border-border bg-background"
    >
      {dock}
    </aside>
  );
}
