import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Blocks, Factory, FlaskConical, Github, Search, Settings } from "lucide-react";
import { factoryTotalsFn, listBlocksFn, statsFn } from "../server/factorio";
import { Card } from "#/components/ui/card.tsx";
import { Button } from "#/components/ui/button.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";

export const Route = createFileRoute("/")({ component: Home });

const tile =
  "flex flex-col gap-1 border border-border bg-card p-4 hover:bg-muted/50 transition-colors";

function Home() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => statsFn() });
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const totals = useQuery({ queryKey: ["factoryTotals"], queryFn: () => factoryTotalsFn() });

  const deficits = (() => {
    const net = new Map<string, number>();
    for (const f of totals.data ?? [])
      net.set(f.item, (net.get(f.item) ?? 0) + (f.role === "import" ? -f.rate : f.rate));
    return [...net.values()].filter((v) => v < -1e-6).length;
  })();

  return (
    <div className="mx-auto max-w-4xl p-4 font-mono text-foreground">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="size-8 shrink-0" />
            PyOps
          </span>
        }
        description="Pyanodons factory planner — blocks, TURD, modules, the lot."
        actions={
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a
              href="https://github.com/ApocDev/pyops"
              target="_blank"
              rel="noreferrer"
              title="View PyOps on GitHub"
            >
              <Github className="size-4" /> GitHub
            </a>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link to="/block" className={tile}>
          <span className="flex items-center gap-1.5 font-semibold">
            <Blocks className="size-4" /> Blocks
          </span>
          <span className="text-sm text-muted-foreground">
            {blocks.data?.length ?? "…"} production block(s) — design chains, pick machines,
            modules, beacons
          </span>
        </Link>
        <Link to="/factory" className={tile}>
          <span className="flex items-center gap-1.5 font-semibold">
            <Factory className="size-4" /> Factory
          </span>
          <span className="text-sm text-muted-foreground">
            whole-factory balance from cached block flows
            {deficits > 0 && <span className="text-destructive"> · {deficits} deficit(s)</span>}
          </span>
        </Link>
        <Link to="/browse" className={tile}>
          <span className="flex items-center gap-1.5 font-semibold">
            <Search className="size-4" /> Browse
          </span>
          <span className="text-sm text-muted-foreground">
            {stats.data ? `${stats.data.recipes.toLocaleString()} recipes` : "…"} — items, fluids,
            used-in / produced-by
          </span>
        </Link>
        <Link to="/turd" className={tile}>
          <span className="flex items-center gap-1.5 font-semibold">
            <FlaskConical className="size-4" /> TURD
          </span>
          <span className="text-sm text-muted-foreground">
            pick your tech-upgrade paths; choices apply to every block
          </span>
        </Link>
      </div>

      {blocks.data?.length === 0 && (
        <EmptyState
          icon={Blocks}
          title="No production blocks yet"
          description="Blocks are the unit of planning — each one turns a target output into sized machines, modules, and flows. Head to Blocks and press the + button in the sidebar to create your first."
          action={
            <Button asChild>
              <Link to="/block">Create your first block</Link>
            </Button>
          }
          className="mt-4 border border-border bg-card"
        />
      )}

      <Card className="mt-4 p-3 text-sm text-muted-foreground">
        New machine? Mod update? Head to{" "}
        <Link
          to="/settings"
          search={{ tab: "data" }}
          className="inline-flex items-center gap-1 text-primary underline"
        >
          <Settings className="size-3.5" /> Settings › Game data
        </Link>{" "}
        to re-sync the game dump — projects each keep their own database.
      </Card>
    </div>
  );
}
