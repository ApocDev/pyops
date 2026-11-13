/** What the assistant's context gauge shows: from `conversationTokenStatusFn`. */
export type TokenStatus = {
  usedTokens: number;
  /** null when the endpoint doesn't report the model's window */
  contextWindow: number | null;
  ratio: number | null;
  /** usedTokens is a chars/4 estimate, not a provider measurement */
  estimated: boolean;
  /** an assistant reply exists, whether or not its usage was measured */
  turnCompleted: boolean;
  modelId: string | null;
  /** the last turn's cost in USD; null means unknown, never free */
  costUsd: number | null;
  resolvedModel: string;
  messageCount: number;
};

/** USD with enough precision for sub-cent turns. */
const formatUsd = (usd: number) => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** The gauge's tooltip. Turn completion and usage measurement are separate: an
 * endpoint can finish a turn without reporting usage or cost, and then the
 * tooltip still names the last turn's cost as unknown. */
export function contextGaugeTitle(status: TokenStatus | undefined): string {
  if (!status) return "context usage";
  const used = status.usedTokens.toLocaleString();
  const fill =
    status.contextWindow != null
      ? `${used} / ${status.contextWindow.toLocaleString()} tokens · ${Math.round(
          Math.min(1, Math.max(0, status.ratio ?? 0)) * 100,
        )}% of context`
      : `${used} tokens · context window not reported by the endpoint`;
  const source = !status.estimated
    ? "measured from the last turn"
    : status.turnCompleted
      ? "estimated (no measured usage for the last turn)"
      : "estimated (no completed turn yet)";
  const cost = status.turnCompleted
    ? `\nlast turn cost: ${status.costUsd == null ? "unknown (not reported by the provider)" : formatUsd(status.costUsd)}`
    : "";
  return (
    `${fill}\n${source}\nmodel: ${status.modelId ?? status.resolvedModel}${cost}` +
    "\n\nClick to compact older messages now"
  );
}
