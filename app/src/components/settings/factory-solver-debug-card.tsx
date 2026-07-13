import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  clearFactorySolverTraceFn,
  factorySolverDebugSettingsFn,
  latestFactorySolverTraceFn,
  setFactorySolverDebugSettingsFn,
} from "#/server/factorio.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";

export function FactorySolverDebugCard() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["factorySolverDebugSettings"],
    queryFn: () => factorySolverDebugSettingsFn(),
  });
  const trace = useQuery({
    queryKey: ["factorySolverTrace"],
    queryFn: () => latestFactorySolverTraceFn(),
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => setFactorySolverDebugSettingsFn({ data: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factorySolverDebugSettings"] }),
  });
  const clear = useMutation({
    mutationFn: () => clearFactorySolverTraceFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factorySolverTrace"] }),
  });
  const [copied, setCopied] = useState(false);
  const value = trace.data ? JSON.stringify(trace.data, null, 2) : "";
  const copy = () => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    if (!trace.data) return;
    const blob = new Blob([value], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pyops-factory-solver-${trace.data.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Factory solver diagnostics</CardTitle>
        {trace.data && <Badge>{trace.data.status}</Badge>}
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        {settings.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <label className="flex items-center justify-between gap-3">
            <span>
              Capture structured solver traces
              <span className="block text-sm text-muted-foreground">
                records factory pins, normalized block columns, the LP model, and its result
              </span>
            </span>
            <Switch
              checked={settings.data?.enabled ?? false}
              disabled={save.isPending}
              onCheckedChange={(enabled) => save.mutate(enabled)}
            />
          </label>
        )}

        <p className="text-sm text-muted-foreground">
          Off by default. The latest trace stays in memory until the app exits or you clear it. It
          contains block names, internal good and recipe IDs, goal rates, and solved flows; it does
          not include API keys or the rest of app configuration.
        </p>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void trace.refetch()}
            disabled={trace.isFetching}
          >
            <RefreshCw className={trace.isFetching ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={copy} disabled={!trace.data}>
            {copied ? <Check className="text-success" /> : <Copy />} Copy JSON
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!trace.data}>
            <Download /> Download JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clear.mutate()}
            disabled={!trace.data || clear.isPending}
          >
            <Trash2 /> Clear
          </Button>
        </div>

        {trace.data ? (
          <div className="space-y-1.5">
            <div className="text-sm text-muted-foreground">
              {trace.data.source} · {trace.data.startedAt} · {trace.data.events.length} events
              {trace.data.truncated ? " · truncated" : ""}
            </div>
            <pre className="max-h-[32rem] overflow-auto border border-border bg-muted/20 p-2 text-sm whitespace-pre">
              {value}
            </pre>
          </div>
        ) : (
          <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
            No trace captured. Enable diagnostics, then open Scenario or select Balance factory.
          </div>
        )}

        {(settings.isError || trace.isError || save.isError || clear.isError) && (
          <p className="text-sm text-destructive">
            Factory solver diagnostics could not be loaded.
          </p>
        )}
      </div>
    </Card>
  );
}
