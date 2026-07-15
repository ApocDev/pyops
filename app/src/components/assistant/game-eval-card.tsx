/**
 * Per-call approval gate for in-game Lua eval (#15). The assistant's gameEval
 * tool only PROPOSES a snippet; this card shows the exact Lua with Run/Dismiss
 * controls. Run sends `cmd.eval` over the bridge (`bridgeEvalFn`) and shows the
 * result inline, with a chip to share that result back into the chat so the
 * agent can continue. Nothing executes without the click — that's the gate.
 */
import { useState } from "react";
import { Check, Gamepad2, Loader2, Play, X } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { bridgeEvalFn } from "#/server/bridge/fns.ts";

export type GameEvalProposal = {
  proposed: true;
  code: string;
  note?: string | null;
};

export function GameEvalCard({
  proposal,
  onShareResult,
  busy,
}: {
  proposal: GameEvalProposal;
  /** send the run's output back into the chat as the next message (#15) */
  onShareResult?: (text: string) => void;
  busy?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed" | "dismissed">(
    "idle",
  );
  const [output, setOutput] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const run = async () => {
    setStatus("running");
    try {
      const r = await bridgeEvalFn({ data: { code: proposal.code } });
      setOutput(r.ok ? (r.result ?? "(No result)") : (r.error ?? "Eval failed"));
      setStatus(r.ok ? "done" : "failed");
    } catch {
      setOutput("Bridge error");
      setStatus("failed");
    }
  };

  const share = () => {
    if (!onShareResult || output == null) return;
    onShareResult(`I ran the proposed Lua snippet. Result:\n\n\`\`\`\n${output}\n\`\`\``);
    setShared(true);
  };

  return (
    <div className="border border-info/40 bg-info/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="size-4 text-info" />
          <span>Proposed in-game Lua</span>
          <InfoHint content="Runs only if you approve it." />
        </div>
        <div className="flex items-center gap-1.5">
          {(status === "idle" || status === "failed") && (
            <>
              <Button size="sm" onClick={() => void run()} title="Run this snippet in the game now">
                <Play className="size-3.5" /> {status === "failed" ? "Retry" : "Run in game"}
              </Button>
              {status === "idle" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStatus("dismissed")}
                  title="Don't run it"
                  className="text-muted-foreground"
                >
                  <X className="size-3.5" /> Dismiss
                </Button>
              )}
            </>
          )}
          {status === "running" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Running…
            </span>
          )}
          {status === "done" && (
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <Check className="size-3.5" /> Ran
            </span>
          )}
          {status === "dismissed" && (
            <span className="text-sm text-muted-foreground">Dismissed</span>
          )}
        </div>
      </div>

      {proposal.note && <p className="mt-2 text-sm text-muted-foreground">{proposal.note}</p>}
      <pre className="mt-2 overflow-auto bg-background p-2 text-sm leading-snug">
        {proposal.code}
      </pre>

      {output != null && (
        <div className="mt-2">
          <div
            className={`text-xs tracking-wide ${
              status === "failed" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {status === "failed" ? "Error" : "Result"}
          </div>
          <pre className="mt-1 max-h-60 overflow-auto bg-background p-2 text-sm leading-snug">
            {output}
          </pre>
          {status === "done" && onShareResult && (
            <Button
              size="sm"
              variant="outline"
              onClick={share}
              disabled={busy || shared}
              className="mt-2 text-muted-foreground hover:text-foreground"
              title="Send the result into the chat so the assistant can continue"
            >
              {shared ? (
                <>
                  <Check className="size-3.5" /> Shared
                </>
              ) : (
                "Share result with assistant"
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
