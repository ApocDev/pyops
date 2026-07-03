import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { listBlocksFn } from "../server/factorio";
import { exportPlanFn, importEnvelopeFn } from "../server/export-fns";
import { downloadJson } from "../lib/download";
import { exportFileName } from "../lib/plan-export";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

type ImportResult = Awaited<ReturnType<typeof importEnvelopeFn>>;

/** Settings card (#82): share blocks between projects (or people) as versioned
 * JSON — export the whole plan here, import a block or plan file into this
 * project. Single blocks also export from the block editor's toolbar. */
export function BlockShareCard() {
  const qc = useQueryClient();
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const fileInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportPlan = useMutation({
    mutationFn: () => exportPlanFn(),
    onSuccess: (env) => downloadJson(exportFileName(env), env),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      // the server validates for real; parsing here just fails fast on non-JSON
      const envelope: unknown = JSON.parse(await file.text());
      return importEnvelopeFn({ data: { envelope } });
    },
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      void qc.invalidateQueries({ queryKey: ["factory"] });
    },
  });

  const count = blocks.data?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share blocks &amp; plans</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Blocks travel as self-contained JSON — goals, recipes, machine/fuel/module picks, folders.
          Import into any project: blocks always come in as new copies (names suffixed on
          collision), and anything the target&apos;s game data doesn&apos;t know is flagged instead
          of rejected. Single blocks export from the block editor&apos;s toolbar.
        </p>
        {blocks.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => exportPlan.mutate()}
              disabled={exportPlan.isPending || count === 0}
              title={count === 0 ? "no blocks to export yet" : undefined}
            >
              <Download className="size-4" />
              {exportPlan.isPending ? "exporting…" : `Export all blocks (${count})`}
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={importFile.isPending}
            >
              <Upload className="size-4" />
              {importFile.isPending ? "importing…" : "Import block/plan JSON…"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) {
                  setResult(null);
                  importFile.mutate(f);
                }
              }}
            />
          </div>
        )}
        {blocks.isError && (
          <p className="text-sm text-destructive">
            couldn&apos;t load blocks: {blocks.error.message}
          </p>
        )}
        {exportPlan.isError && (
          <p className="text-sm text-destructive">export failed: {exportPlan.error.message}</p>
        )}
        {importFile.isError && (
          <p className="text-sm text-destructive">import failed: {importFile.error.message}</p>
        )}
        {result && (
          <div className="space-y-1 border border-border bg-muted/20 p-2 text-sm">
            <div className="text-success">
              imported {result.blocks.length} block{result.blocks.length === 1 ? "" : "s"}
              {result.groupsCreated > 0 &&
                ` · ${result.groupsCreated} folder${result.groupsCreated === 1 ? "" : "s"}`}
            </div>
            {result.blocks.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2">
                <Link
                  to="/block/$id"
                  params={{ id: String(b.id) }}
                  className="text-info underline underline-offset-2"
                >
                  {b.name}
                </Link>
                {b.broken && (
                  <Badge
                    variant="destructive"
                    title={[
                      // missing refs have no display name here by definition —
                      // the internal name is all the target data knows
                      b.missing.recipes.length
                        ? `missing recipes: ${b.missing.recipes.join(", ")}`
                        : "",
                      b.missing.goods.length ? `missing goods: ${b.missing.goods.join(", ")}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    missing {b.missing.recipes.length + b.missing.goods.length} reference
                    {b.missing.recipes.length + b.missing.goods.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
