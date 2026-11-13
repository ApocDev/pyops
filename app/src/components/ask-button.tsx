import { useRouterState } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { ASK_HOTKEY, toggleDock, useDock } from "../lib/assistant-dock";
import { useFormattedCombo } from "../lib/hotkeys";
import { Button } from "#/components/ui/button.tsx";
import { Kbd } from "#/components/ui/kbd.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** Top-bar toggle for the assistant dock. `label` is the full desktop bar's icon
 * plus "Ask"; `icon` is the folded bar's touch-sized button. Hidden on the Assistant page, which is the full view. */
export function AskButton({ size }: { size: "label" | "icon" }) {
  const { open } = useDock();
  const combo = useFormattedCombo(ASK_HOTKEY);
  const onAssistant = useRouterState({ select: (s) => s.location.pathname === "/assistant" });
  if (onAssistant) return null;
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-2">
          Ask about this page <Kbd>{combo}</Kbd>
        </span>
      }
    >
      <Button
        variant="ghost"
        aria-label="Ask"
        aria-pressed={open}
        aria-keyshortcuts="Control+."
        onClick={toggleDock}
        className={
          size === "icon"
            ? `size-10 hover:bg-muted/50 ${open ? "text-primary" : "text-muted-foreground"}`
            : `h-full gap-1.5 border-0 border-b-2 px-3 font-normal hover:bg-muted/50 ${
                open
                  ? "border-primary bg-muted/30 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`
        }
      >
        <Sparkles className={size === "icon" ? "size-5" : "size-4 text-primary"} />
        {size === "label" && "Ask"}
      </Button>
    </Tooltip>
  );
}
