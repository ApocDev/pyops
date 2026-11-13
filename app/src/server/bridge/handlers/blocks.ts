/**
 * Block bridge handlers — the in-game Blocks tab (slot board).
 *
 * `block.list` — the mod pulls the enabled blocks, grouped by folder, with each
 * block's goal rate and built-vs-needed machine totals. The app also pushes the
 * same message unsolicited whenever that payload changes (checked on each
 * heartbeat), so the board follows edits, undo, project switches, and new
 * built counts without the mod polling for them.
 *
 * `block.show` — a slot was clicked: push that block's build sheet
 * (`cmd.show_block`), the same payload as the web "show in game" button.
 *
 * `block.open` — a slot was shift-clicked (or the sheet's "open in PyOps"
 * button): hold the request so the web UI, which polls bridge status, can
 * navigate to that block.
 */
import * as q from "../../../db/queries.server.ts";
import { currentSolveGeneration } from "../../../db/solve-generation.server.ts";
import { showBlockInGame } from "../../block-compute.server.ts";
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";
import { sendToPeer } from "../server.ts";

type ListedBlock = ReturnType<typeof q.listBlocks>[number];
type Group = ReturnType<typeof q.listGroups>[number];

/** One slot on the board. `goal.rate` is per second; `unit` is the block's
 * display unit, which the mod applies. `have`/`need` are whole machines.
 * `rows` is the per-row built counts ("5,0"). `rev` is "<last edit>.<solve
 * generation>": the edit time (epoch seconds) moves on a block edit, and the
 * generation moves when research or TURD changes re-solve blocks without
 * touching their edit time. The mod re-requests an open build sheet when `rows`
 * or `rev` changes. */
export type WireBlock = {
  id: number;
  name: string;
  icon: { kind: string; name: string } | null;
  goal: { name: string; kind: "item" | "fluid"; rate: number; unit: string } | null;
  powerW: number;
  health: ListedBlock["health"];
  have: number;
  need: number;
  rows: string;
  rev: string;
};

export type BlockListPayload = { groups: { name: string; blocks: WireBlock[] }[] };

/** Folder rows in sidebar order: each folder followed by its subfolders,
 * labeled with the full path ("Metals / Iron"). */
function orderedGroups(groups: Group[]): { id: number; label: string }[] {
  const byParent = new Map<number | null, Group[]>();
  for (const g of groups) {
    const key = g.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), g]);
  }
  const out: { id: number; label: string }[] = [];
  const walk = (parent: number | null, prefix: string) => {
    for (const g of byParent.get(parent) ?? []) {
      const label = prefix ? `${prefix} / ${g.name}` : g.name;
      out.push({ id: g.id, label });
      walk(g.id, label);
    }
  };
  walk(null, "");
  return out;
}

/** Group enabled blocks into board rows: folders in sidebar order, blocks in
 * their sidebar order, a trailing "Ungrouped" row, empty rows dropped. Pure so
 * the ordering is unit-testable. */
export function groupBlocks(
  blocks: WireBlock[],
  groupOf: Map<number, number | null>,
  groups: Group[],
): BlockListPayload {
  const rows = [...orderedGroups(groups), { id: null, label: "Ungrouped" }].map((g) => ({
    id: g.id,
    name: g.label,
    blocks: [] as WireBlock[],
  }));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const ungrouped = rows[rows.length - 1];
  for (const b of blocks) (rowById.get(groupOf.get(b.id) ?? null) ?? ungrouped).blocks.push(b);
  return {
    groups: rows.filter((r) => r.blocks.length > 0).map(({ name, blocks }) => ({ name, blocks })),
  };
}

/** Build the `block.list` payload from the active project. */
export function blockListPayload(): BlockListPayload {
  const totals = q.blockBuildTotals();
  const generation = currentSolveGeneration();
  const groupOf = new Map<number, number | null>();
  const blocks: WireBlock[] = [];
  for (const b of q.listBlocks()) {
    if (!b.enabled) continue;
    groupOf.set(b.id, b.groupId);
    const t = totals.get(b.id) ?? { need: 0, missing: 0, rows: "" };
    const g = b.goal;
    blocks.push({
      id: b.id,
      name: b.name,
      icon: b.iconKind && b.iconName ? { kind: b.iconKind, name: b.iconName } : null,
      goal: g
        ? {
            name: g.name,
            kind: q.getFluid(g.name) ? "fluid" : "item",
            rate: Math.abs(g.rate),
            unit: g.unit ?? "s",
          }
        : null,
      powerW: b.electricityW ?? 0,
      health: b.health,
      have: t.need - t.missing,
      need: t.need,
      rows: t.rows,
      rev: `${b.updatedAt ? Math.floor(b.updatedAt.getTime() / 1000) : 0}.${generation}`,
    });
  }
  return groupBlocks(blocks, groupOf, q.listGroups());
}

// The last payload the mod received, serialized. Module state, so a dev-server
// module reload just means one extra (idempotent) push.
let lastSent: string | null = null;

/** `block.list` — reply with the full list (the mod asks on connect, resync,
 * and panel open). */
export function handleBlockList(req: BridgeRequest): BridgeResponse {
  const payload = blockListPayload();
  lastSent = JSON.stringify(payload);
  return { type: "block.list", request_id: req.request_id, payload };
}

/** Push `block.list` when it differs from what the mod last got. Called on
 * every heartbeat; a no-op until the mod has asked for the list once. */
export function pushBlockListIfChanged(): void {
  if (lastSent === null) return;
  const payload = blockListPayload();
  const json = JSON.stringify(payload);
  if (json === lastSent) return;
  if (sendToPeer({ type: "block.list", payload })) lastSent = json;
}

const blockId = (req: BridgeRequest): number | null => {
  const id = (req.payload as { id?: unknown } | undefined)?.id;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
};

/** `block.show` — push the clicked block's build sheet. */
export async function handleBlockShow(req: BridgeRequest): Promise<null> {
  const id = blockId(req);
  if (id !== null) await showBlockInGame(id);
  return null;
}

export type OpenBlockRequest = { id: number; at: number };
let lastOpen: OpenBlockRequest | null = null;

/** `block.open` — remember the block to open; the web UI navigates to it. */
export function handleBlockOpen(req: BridgeRequest): null {
  const id = blockId(req);
  if (id !== null) lastOpen = { id, at: Date.now() };
  return null;
}

/** The latest open-in-web request from the game, if any this app session. */
export function lastOpenBlockRequest(): OpenBlockRequest | null {
  return lastOpen;
}
