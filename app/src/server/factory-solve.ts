/**
 * Factory-level what-if solver: treat the whole factory as one block whose
 * sub-units are *blocks* instead of recipes. Each block is a fixed-ratio
 * "super-recipe" (its cached boundary flows at the current rate); the unknown is
 * the block's scale factor. We solve a small LP for the scales that satisfy every
 * demand/consumption — the required per-block rate changes for the factory.
 *
 * Why an LP and not the exact block solver: real Py factories can't balance every
 * good exactly (multi-product blocks force off-ratio surplus), so exact equality
 * is infeasible. The LP uses production >= demand (surplus allowed) and minimizes
 * total scaling, which is always feasible and matches "scale up/down to meet it".
 *
 * Report-only: it never writes; you adjust each block by hand (or ignore).
 */
import highsLoader from "highs";

export type BlockWithFlows = {
  id: number;
  name: string;
  rate: number;
  flows: { item: string; kind: string; role: string; rate: number }[];
};

type GoodClass = "raw" | "demand" | "surplus" | "intermediate";

// Energy pseudo-goods are grid utilities / block-local, not block-to-block flows —
// don't balance them across the factory (they'd create a power feedback loop).
const FREE_GOODS = new Set(["pyops-electricity", "pyops-heat"]);

function addTo<K, V>(map: Map<K, Set<V>>, key: K, val: V) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set<V>()));
  s.add(val);
}
function bump(map: Map<string, number>, key: string, amt: number) {
  map.set(key, (map.get(key) ?? 0) + amt);
}
const round = (n: number) => +n.toFixed(4);

export async function factoryWhatIf(
  blocks: BlockWithFlows[],
  demandOverrides: Record<string, number> = {},
) {
  const kindOf = new Map<string, string>();
  const producedTotal = new Map<string, number>();
  const consumedTotal = new Map<string, number>();
  const primaryProducers = new Map<string, Set<number>>();
  const anyProducers = new Map<string, Set<number>>();
  const consumers = new Map<string, Set<number>>();
  // net flow of each good per block, at the block's CURRENT rate (scale 1)
  const netByBlock = blocks.map((b) => {
    const net = new Map<string, number>();
    for (const f of b.flows) {
      kindOf.set(f.item, f.kind);
      if (f.role === "import") {
        addTo(consumers, f.item, b.id);
        bump(consumedTotal, f.item, f.rate);
        bump(net, f.item, -f.rate);
      } else {
        addTo(anyProducers, f.item, b.id);
        if (f.role === "primary" || f.role === "stock") addTo(primaryProducers, f.item, b.id);
        bump(producedTotal, f.item, f.rate);
        bump(net, f.item, f.rate);
      }
    }
    return net;
  });

  const goods = [...kindOf.keys()];
  // Balance the dependency chain through block PRIMARY outputs only. Byproducts are
  // free surplus at the good level — forcing them to balance blows up Py's fuel/
  // recycle loops (a byproduct consumed by a productive block, scaled to absorb,
  // overproduces that block's primary).
  const classify = (g: string): GoodClass => {
    if (FREE_GOODS.has(g)) return "raw"; // grid utility — free boundary
    const anyProd = (anyProducers.get(g)?.size ?? 0) > 0;
    if (!anyProd) return "raw"; // never produced → external input
    const isPrimary = (primaryProducers.get(g)?.size ?? 0) > 0;
    const consumed = (consumers.get(g)?.size ?? 0) > 0;
    if (isPrimary && !consumed) return "demand"; // final product → pin
    if (isPrimary && consumed) return "intermediate"; // chain link → balance
    return "surplus"; // byproduct → free at the good level
  };

  // A block is "productive" if a primary output is on the demand chain; a "sink" is a
  // dedicated consumer — off-chain AND it consumes a byproduct. We scale productive
  // blocks for demands, and sinks to soak up byproduct surplus, but never scale a
  // productive block just to consume a byproduct (that's what caused the blow-ups).
  const idToIdx = new Map(blocks.map((b, bi) => [b.id, bi]));
  const productive = blocks.map((b) =>
    b.flows.some(
      (f) =>
        (f.role === "primary" || f.role === "stock") &&
        (classify(f.item) === "demand" || classify(f.item) === "intermediate"),
    ),
  );
  const sink = blocks.map(
    (b, bi) =>
      !productive[bi] && b.flows.some((f) => f.role === "import" && classify(f.item) === "surplus"),
  );

  const demandRate = (g: string) => demandOverrides[g] ?? producedTotal.get(g) ?? 0;
  const constraints: string[] = [];
  // chain constraints: demands (net >= pinned), intermediates (net >= 0)
  for (const g of goods) {
    const cls = classify(g);
    if (cls !== "demand" && cls !== "intermediate") continue;
    const parts: string[] = [];
    blocks.forEach((_, bi) => {
      const c = netByBlock[bi].get(g) ?? 0;
      if (Math.abs(c) > 1e-9) parts.push(`${c >= 0 ? "+" : "-"} ${Math.abs(c)} s${bi}`);
    });
    if (parts.length)
      constraints.push(
        `r${constraints.length}: ${parts.join(" ")} >= ${cls === "demand" ? demandRate(g) : 0}`,
      );
  }
  // Objective: minimize total scaling. (Auto-scaling sinks inside the LP is unstable
  // — rewarding byproduct intake makes the solve overproduce byproducts just to
  // consume them. So sinks are pinned here and sized as a post-process suggestion.)
  const obj = blocks.map((_, bi) => `+ 1 s${bi}`).join(" ");

  // Only productive blocks (a demand/intermediate primary) are free to scale; sinks
  // and pure off-chain (power/utility) blocks are pinned at current.
  const bounds = blocks
    .map((_, bi) => (productive[bi] ? `0 <= s${bi} <= 1e7` : `1 <= s${bi} <= 1`))
    .join("\n ");
  const lp = `Minimize\n obj: ${obj}\nSubject To\n ${constraints.join("\n ")}\nBounds\n ${bounds}\nEnd`;

  const highs = await highsLoader();
  const sol = highs.solve(lp);
  const scaleById = new Map<number, number>();
  blocks.forEach((b, bi) =>
    scaleById.set(b.id, (sol.Columns[`s${bi}`] as { Primal?: number } | undefined)?.Primal ?? 0),
  );

  // projected good flows at the solved scales
  const projProduced = new Map<string, number>();
  const projConsumed = new Map<string, number>();
  for (const b of blocks) {
    const s = scaleById.get(b.id) ?? 0;
    for (const f of b.flows) {
      if (f.role === "import") bump(projConsumed, f.item, s * f.rate);
      else bump(projProduced, f.item, s * f.rate);
    }
  }

  const good = (g: string) => ({ good: g, kind: kindOf.get(g) ?? "item" });
  const blockReport = blocks
    .map((b) => {
      const scale = scaleById.get(b.id) ?? 0;
      return {
        id: b.id,
        name: b.name,
        currentRate: round(b.rate),
        requiredRate: round(b.rate * scale),
        scale: round(scale),
        delta: round(b.rate * scale - b.rate),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // surplus to handle = anything overproduced (no-consumer byproducts + intermediates
  // produced beyond what's consumed) — the cue to grow/route a consumer block. When a
  // dedicated sink already consumes it, suggest how far to scale that sink to absorb
  // the surplus (computed from the fixed solve, so it never feeds back into it).
  const absorbHint = (g: string) => {
    const sinkId = [...(consumers.get(g) ?? [])].find((id) => sink[idToIdx.get(id)!]);
    if (sinkId == null) return null;
    const sb = blocks[idToIdx.get(sinkId)!];
    const intake = sb.flows.find((f) => f.item === g && f.role === "import")?.rate ?? 0;
    if (intake <= 1e-9) return null;
    const surplus = (projProduced.get(g) ?? 0) - (projConsumed.get(g) ?? 0);
    return { id: sb.id, name: sb.name, scale: round(1 + surplus / intake) };
  };
  const overproduced = goods
    .map((g) => ({
      ...good(g),
      cls: classify(g),
      projected: round((projProduced.get(g) ?? 0) - (projConsumed.get(g) ?? 0)),
      absorb: classify(g) === "surplus" ? absorbHint(g) : null,
    }))
    .filter((x) => (x.cls === "surplus" || x.cls === "intermediate") && x.projected > 1e-3)
    .sort((a, b) => b.projected - a.projected);

  return {
    status: sol.Status,
    blocks: blockReport,
    demands: goods
      .filter((g) => classify(g) === "demand")
      .map((g) => ({
        ...good(g),
        current: round(producedTotal.get(g) ?? 0),
        target: round(demandRate(g)),
      }))
      .sort((a, b) => b.target - a.target),
    raws: goods
      .filter((g) => classify(g) === "raw")
      .map((g) => ({
        ...good(g),
        current: round(consumedTotal.get(g) ?? 0),
        projected: round(projConsumed.get(g) ?? 0),
      }))
      .sort((a, b) => b.projected - a.projected),
    overproduced,
  };
}
