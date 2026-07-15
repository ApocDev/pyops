import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Crown, Gamepad2, Timer, Waves } from "lucide-react";
import { planSushi, type ResolvedLogistics, type SushiFlow } from "../../lib/logistics";
import { constantCombinatorBlueprint, encodeBlueprint } from "../../lib/blueprint";
import { fmtSpoilTime, Icon, useSpoilables } from "../../lib/icons";
import { toast } from "../../lib/toast-store";
import { bridgeStatusSubscription } from "../../lib/live-query-options";
import { bridgeBlueprintFn, sushiTraceInfoFn } from "../../server/bridge/fns";
import { fmtCount } from "./format.ts";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { StatTableHeader } from "#/components/stat-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";

/** A solid item flow offered to the sushi loop: an import, an export, or an
 * internal row-to-row intermediate (`int`) — in the "everything on one belt"
 * pattern they all ride the same loop. */
export type SushiPlannerFlow = {
  name: string;
  display: string | null;
  rate: number;
  role: "in" | "out" | "int";
};

const ROLE_STYLE: Record<SushiPlannerFlow["role"], string> = {
  in: "bg-warning/15 text-warning",
  out: "bg-surplus/15 text-surplus",
  int: "bg-success/15 text-success",
};
const ROLE_LABEL: Record<SushiPlannerFlow["role"], string> = {
  in: "IN",
  out: "OUT",
  int: "INT",
};

const TILES_KEY = "pyops.sushiTiles";
const DEFAULT_TILES = 100;

const VERDICT_COPY: Record<
  NonNullable<ReturnType<typeof planSushi>>["verdict"],
  { tone: "success" | "info" | "warning" | "destructive"; text: string }
> = {
  comfortable: { tone: "success", text: "Comfortable — one loop carries this with headroom" },
  tight: { tone: "info", text: "Workable — the loop runs busy; keep insertion circuit-limited" },
  fragile: {
    tone: "warning",
    text: "Fragile — near belt capacity, little room for gaps; a faster belt or fewer items would help",
  },
  "over-capacity": {
    tone: "destructive",
    text: "Over capacity — the summed flow exceeds one belt; split items off or upgrade the belt",
  },
  "loop-too-small": {
    tone: "destructive",
    text: "Loop too small — the per-item set-points don't physically fit; lengthen the loop",
  },
};

/** Treat the mod as connected if we've heard from it within this window
 * (mirrors bridge-indicator). */
const FRESH_MS = 6000;

/** "Sushi planner" — sizes one mixed loop for everything the block moves
 * (imports, exports, internal intermediates): verdict vs belt capacity,
 * per-item on-belt set-points (the circuit constants), pass frequency, and
 * spoil-dwell warnings. Owns its trigger, like HorizonMenu. */
export function SushiPlanner({
  flows,
  resolved,
  blockName,
}: {
  flows: SushiPlannerFlow[];
  resolved: ResolvedLogistics;
  blockName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tiles, setTiles] = useState(() => {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(TILES_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TILES;
  });
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const spoilTicks = useSpoilables();

  const included = useMemo(() => flows.filter((f) => !excluded.has(f.name)), [flows, excluded]);
  const sushiFlows: SushiFlow[] = useMemo(
    () =>
      included.map((f) => ({
        name: f.name,
        rate: f.rate,
        role: f.role,
        ...(spoilTicks[f.name] != null ? { spoilSeconds: spoilTicks[f.name] / 60 } : {}),
      })),
    [included, spoilTicks],
  );
  const plan = planSushi(resolved, sushiFlows, tiles);
  const display = new Map(flows.map((f) => [f.name, f.display ?? f.name]));

  const setTilesPersisted = (n: number) => {
    setTiles(n);
    if (typeof localStorage !== "undefined") localStorage.setItem(TILES_KEY, String(n));
  };
  const toggle = (name: string) => {
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExcluded(next);
  };
  const copySetPoints = () => {
    if (!plan) return;
    const text = plan.rows.map((r) => `${display.get(r.name) ?? r.name}: ${r.onBelt}`).join("\n");
    void navigator.clipboard.writeText(text);
    toast({ message: "Set-points copied — one “item: count on loop” per line" });
  };

  // The set-point combinator: every item at MINUS its on-loop count (the request
  // convention) — wire the loop's read contents to the same network and
  // "each < 0" marks items below set-point. One section per role, in/out/int:
  // only the block-inputs section ships ACTIVE (imports are what's injected from
  // outside, so they're what needs gating); outputs and intermediates free-flow,
  // their set-points parked in disabled sections as flippable reference.
  const bridge = useQuery(bridgeStatusSubscription);
  const peer = bridge.data?.lastPeer ?? null;
  const connected = peer != null && Date.now() - peer.lastSeenMs < FRESH_MS;
  // the mod's ALT+B loop tracer pushes its measurement here — offer, don't overwrite
  const measured = useQuery({
    queryKey: ["sushiTrace"],
    queryFn: () => sushiTraceInfoFn(),
    enabled: open,
    refetchInterval: 3000,
  });
  const trace = measured.data ?? null;
  const buildBlueprint = () => {
    if (!plan) return null;
    const section = (role: SushiPlannerFlow["role"], active: boolean) => ({
      active,
      signals: plan.rows
        .filter((r) => r.role === role)
        .map((r) => ({ name: r.name, type: "item" as const, count: -r.onBelt })),
    });
    return constantCombinatorBlueprint(`Sushi: ${blockName ?? "block"}`, [
      section("in", true),
      section("out", false),
      section("int", false),
    ]);
  };
  const sendToGame = useMutation({
    mutationFn: async () => {
      const bp = buildBlueprint();
      if (!bp) throw new Error("nothing to send");
      return bridgeBlueprintFn({ data: { bp: await encodeBlueprint(bp) } });
    },
    onSuccess: (r) =>
      toast(
        r.sent
          ? { message: "Blueprint sent — it's on your cursor in game" }
          : { message: "No mod connected", tone: "destructive" },
      ),
    onError: (e) =>
      toast({ message: e instanceof Error ? e.message : String(e), tone: "destructive" }),
  });
  const copyBlueprint = async () => {
    const bp = buildBlueprint();
    if (!bp) return;
    await navigator.clipboard.writeText(await encodeBlueprint(bp));
    toast({ message: "Blueprint string copied — import it in game" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          <Waves className="size-3.5" /> Sushi
        </Button>
      </DialogTrigger>
      <DialogContent className="md:max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>Sushi planner</DialogTitle>
          <HelpButton title="Sushi planner" className="mr-7 ml-auto">
            <p>
              Sizes <b className="text-foreground">one mixed belt loop</b> carrying every solid item
              this block moves — imports (<span className="text-warning">in</span>), exports (
              <span className="text-surplus">out</span>), and row-to-row intermediates (
              <span className="text-success">int</span>) — the "everything on the same belt" pattern
              where machines pull ingredients off and drop products on. A good's belt rate is the
              larger of its production and consumption across the rows.
            </p>
            <p>
              <b className="text-foreground">Capacity</b> — a belt's throughput doesn't depend on
              the item mix, so the loop is bounded by the summed rate against one belt. Under ~60%
              of capacity is comfortable, up to ~85% workable; beyond that gaps get scarce and
              insertion stalls.
            </p>
            <p>
              <b className="text-foreground">On-belt set-points</b> — in steady state each item's
              stock on the loop is its rate × one lap's travel time (never less than 2, so trace
              ingredients still cycle past their consumers). These are exactly the per-item
              constants for a circuit-controlled loop: read the belt's contents holistically and
              enable each item's inserters only while its count is below the set-point. The Σ of
              set-points must fit the loop's physical slots (8 per tile per stack level).
            </p>
            <p>
              <b className="text-foreground">Loop length</b> — sets lap time, and with it the pass
              frequency ("seen every") and how long items dwell on the loop. Longer loops buffer
              more but cycle slower: trace items get sparse and spoilables rot in transit (flagged
              when riding the loop eats over a quarter of an item's spoil time). With the game
              linked, hover any belt of the built loop and press ALT+B — the mod traces it, wires
              every segment onto one red network for reading, and the measured length appears here
              as a one-click "measured" chip (SHIFT+ALT+B undoes the last trace).
            </p>
            <p>
              The planner covers capacity and composition only — it can't verify the control side.
              Without filtered or circuit-limited insertion a single item will eventually flood any
              sushi loop.
            </p>
            <p>
              <b className="text-foreground">Read accuracy</b> — the wire runs a little under the
              true stock: items inside splitters are invisible to circuits (nothing any wiring can
              fix), and reads can include items on feeder branches next to the loop. On a healthy
              circulating loop the error is a handful of items; treat set-points as self-correcting
              approximations, not exact counts.
            </p>
            <p>
              <b className="text-foreground">Getting the constants in game</b> — "to cursor in game"
              drops a ready-made constant combinator on your cursor via the live bridge (each item
              at minus its set-point, the request convention). "Copy blueprint" gives the same
              combinator as an importable string for players without the mod.
            </p>
            <p>
              The combinator holds one section per role — inputs, then outputs, then intermediates.
              Only the <b className="text-foreground">inputs</b> section is enabled: imports are
              what's injected from outside, so they're what needs gating; everything else free-flows
              off the machines. The other sections ship toggled off as reference — if an
              intermediate ever floods the loop, tick its section on and filter that item's
              inserter, no replanning needed.
            </p>
          </HelpButton>
        </DialogHeader>
        <DialogBody>
          <section className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="space-y-1.5">
              <FieldLabel>Loop length</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  step={10}
                  value={tiles}
                  aria-label="Loop length in belt tiles"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) setTilesPersisted(n);
                  }}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">tiles</span>
                {trace && trace.tiles !== tiles && (
                  <Tooltip
                    content={`Traced in-game (ALT+B): ${trace.tiles} tiles, ${trace.segments} segment(s)${trace.closed ? "" : " — not a closed loop"} — click to use`}
                  >
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setTilesPersisted(trace.tiles)}
                    >
                      <Gamepad2 className="size-3" /> Measured {trace.tiles}
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
            {plan && (
              <div className="pb-1 text-sm text-muted-foreground">
                Lap ≈ {fmtCount(plan.lapSeconds)} s · {plan.onBeltTotal}/{plan.slots} slots ·{" "}
                <span className="inline-flex items-center gap-1 align-bottom">
                  <Icon kind="entity" name={resolved.belt?.name ?? ""} size="sm" noHover />
                  {Math.round(plan.utilization * 100)}%
                </span>
              </div>
            )}
          </section>

          {plan ? (
            <Callout tone={VERDICT_COPY[plan.verdict].tone}>
              {VERDICT_COPY[plan.verdict].text}
            </Callout>
          ) : (
            <EmptyState
              title="Not enough flows"
              description="Sushi needs at least two included solid flows with a positive rate."
            />
          )}

          {plan && (
            <section className="space-y-1">
              <StatTableHeader
                lead="Item (untick to keep off the loop)"
                cols={[
                  { label: "/s", w: "w-16" },
                  { label: "Share", w: "w-14" },
                  { label: "On belt", w: "w-16" },
                  { label: "Seen every", w: "w-20" },
                ]}
                className="px-0"
              />
              {flows.map((f) => {
                const row = plan.rows.find((r) => r.name === f.name);
                const off = excluded.has(f.name);
                return (
                  <div
                    key={f.name}
                    className={`flex flex-col gap-1 border-t border-border py-1.5 md:flex-row md:items-center ${off ? "opacity-50" : ""}`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <Checkbox checked={!off} onCheckedChange={() => toggle(f.name)} />
                      <Icon kind="item" name={f.name} size="sm" />
                      <span className="truncate text-sm" title={f.display ?? f.name}>
                        {f.display ?? f.name}
                      </span>
                      <span className={`px-1 text-xs ${ROLE_STYLE[f.role]}`}>
                        {ROLE_LABEL[f.role]}
                      </span>
                      {row?.dominant && (
                        <Tooltip content="Over half the loop — a dedicated belt or lane likely serves it better; untick it to see the loop without it">
                          <Crown className="size-3.5 shrink-0 text-warning" />
                        </Tooltip>
                      )}
                      {row?.spoilRisk && (
                        <Tooltip
                          content={`Rides the loop ≈${fmtCount(row.dwellSeconds)} s of its ${fmtSpoilTime(spoilTicks[f.name])} spoil time — shorten the loop or keep it off`}
                        >
                          <Timer className="size-3.5 shrink-0 text-destructive" />
                        </Tooltip>
                      )}
                    </label>
                    <div className="grid grid-cols-4 gap-1 pl-6 text-sm tabular-nums md:flex md:pl-0 md:text-right">
                      <span className="md:w-16">{fmtCount(f.rate)}</span>
                      <span className="text-muted-foreground md:w-14">
                        {row ? `${Math.round(row.share * 100)}%` : "—"}
                      </span>
                      <span className="md:w-16">{row ? row.onBelt : "—"}</span>
                      <span
                        className={`md:w-20 ${row?.sparse ? "text-warning" : "text-muted-foreground"}`}
                        title={row?.sparse ? "Sparse — passes a consumer rarely" : undefined}
                      >
                        {row ? `${fmtCount(row.seenEverySeconds)} s` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {plan && (
            <section className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Tooltip
                content={
                  connected
                    ? "Put the set-point combinator on your cursor in game"
                    : "Needs the companion mod connected (Live bridge)"
                }
              >
                <Button
                  size="sm"
                  onClick={() => sendToGame.mutate()}
                  disabled={!connected || sendToGame.isPending}
                >
                  <Gamepad2 className="size-3.5" />
                  {sendToGame.isPending ? "Sending…" : "To cursor in game"}
                </Button>
              </Tooltip>
              <Tooltip content="The same combinator as an importable blueprint string — no mod needed">
                <Button variant="outline" size="sm" onClick={() => void copyBlueprint()}>
                  <ClipboardCopy className="size-3.5" /> Copy blueprint
                </Button>
              </Tooltip>
              <Tooltip content='Plain text, one "item: count on loop" per line'>
                <Button variant="outline" size="sm" onClick={copySetPoints}>
                  Copy as text
                </Button>
              </Tooltip>
            </section>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
