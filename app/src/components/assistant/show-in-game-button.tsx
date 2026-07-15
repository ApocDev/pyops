/**
 * "Show in game" on assistant cards (#14): push a CREATED block to the in-game
 * build-sheet panel over the UDP bridge — the same `bridgeShowBlockFn` the
 * block editor's toolbar uses. The in-game sheet is also the door to the
 * request-combinator blueprint generator (click a building there), so a plan
 * can go from chat straight into the game. Only meaningful once the block
 * exists (has an id) — the cards render this on their post-create state.
 */
import { useState } from "react";
import { Check, Gamepad2, Loader2 } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { bridgeShowBlockFn } from "#/server/factorio";

export function ShowInGameButton({ blockId, label }: { blockId: number; label?: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "offline">("idle");

  const show = async () => {
    setStatus("sending");
    try {
      const r = await bridgeShowBlockFn({ data: blockId });
      setStatus(r.sent ? "sent" : "offline");
    } catch {
      setStatus("offline");
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void show()}
        disabled={status === "sending"}
        title="Show in game — opens this block as the in-game build sheet (click a building there for a configured blueprint / request combinator). Needs the bridge connected."
        className="text-muted-foreground hover:text-foreground"
      >
        {status === "sending" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Gamepad2 className="size-3.5" />
        )}
        {label ?? "Show in game"}
      </Button>
      {status === "sent" && (
        <span className="inline-flex items-center gap-1 text-sm text-success">
          <Check className="size-3.5" /> Opened in game
        </span>
      )}
      {status === "offline" && <span className="text-sm text-warning">Game not connected</span>}
    </span>
  );
}
