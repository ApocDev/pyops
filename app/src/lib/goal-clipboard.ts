import type { Goal } from "../db/schema.ts";
import { STOCK_WINDOW_DEFAULT } from "./goals.ts";

const GOAL_CLIPBOARD_KIND = "pyops/goals";
const GOAL_CLIPBOARD_VERSION = 1;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalFinite = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

/** Copy the user's goal intent, excluding factoryRate because it is derived from
 * the source block's factory context and must be recomputed for the destination. */
function clipboardGoal(value: unknown): Goal | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  if (typeof value.rate !== "number" || !Number.isFinite(value.rate)) return null;
  if (
    value.direction !== undefined &&
    value.direction !== "produce" &&
    value.direction !== "consume"
  )
    return null;
  if (value.unit !== undefined && value.unit !== "s" && value.unit !== "min" && value.unit !== "h")
    return null;
  if (!optionalFinite(value.stock) || (value.stock !== undefined && value.stock <= 0)) return null;
  if (!optionalFinite(value.window) || (value.window !== undefined && value.window <= 0))
    return null;
  if (!optionalFinite(value.temperature)) return null;

  return {
    name: value.name.trim(),
    rate:
      value.stock !== undefined ? value.stock / (value.window ?? STOCK_WINDOW_DEFAULT) : value.rate,
    ...(value.direction ? { direction: value.direction } : {}),
    ...(value.unit ? { unit: value.unit } : {}),
    ...(value.stock !== undefined ? { stock: value.stock } : {}),
    ...(value.window !== undefined ? { window: value.window } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
  };
}

/** Versioned, human-readable clipboard payload for moving goals between blocks. */
export function serializeGoalsClipboard(goals: readonly Goal[]): string {
  const copied = goals.map((goal) => {
    const value = clipboardGoal(goal);
    if (!value) throw new Error("Cannot copy an invalid goal");
    return value;
  });
  return JSON.stringify(
    {
      kind: GOAL_CLIPBOARD_KIND,
      version: GOAL_CLIPBOARD_VERSION,
      goals: copied,
    },
    null,
    2,
  );
}

/** Read goals-only payloads and the existing Copy setup JSON (which also has a
 * top-level goals array). Unknown versions and malformed goals are rejected as
 * a whole so paste can never partially mutate a block. */
export function parseGoalsClipboard(text: string): Goal[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if ("kind" in value && (value.kind !== GOAL_CLIPBOARD_KIND || value.version !== 1)) return null;
  if (!Array.isArray(value.goals)) return null;
  const goals = value.goals.map(clipboardGoal);
  return goals.every((goal): goal is Goal => goal !== null) ? goals : null;
}
