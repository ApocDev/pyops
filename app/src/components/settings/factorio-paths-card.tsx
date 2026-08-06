import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import { factorioPathsFn, setFactorioPathsFn, type FactorioPathField } from "../../server/factorio";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { InfoHint } from "../info-hint";

type PathKey = "bin" | "dataDir" | "modsDir";

const FIELDS: { key: PathKey; label: string; hint: string; env: string }[] = [
  {
    key: "bin",
    label: "Factorio executable",
    hint: "The game binary, e.g. Factorio/bin/x64/factorio — used by game-data sync and Launch Factorio.",
    env: "FACTORIO_BIN",
  },
  {
    key: "dataDir",
    label: "Factorio user-data folder",
    hint: "Contains Factorio's configuration, saves, mods, and script-output — not the installation folder.",
    env: "FACTORIO_DATA_DIR",
  },
  {
    key: "modsDir",
    label: "Factorio mods folder",
    hint: "The folder that directly contains mod-list.json and installed mods. Defaults to <user-data>/mods.",
    env: "FACTORIO_MODS_DIR",
  },
];

/** Where Factorio lives on this machine — stored in app config, editable here.
 * Env vars always win; blank fields fall back to the per-OS platform default. */
export function FactorioPathsCard() {
  const qc = useQueryClient();
  const paths = useQuery({ queryKey: ["factorioPaths"], queryFn: () => factorioPathsFn() });
  const save = useMutation({
    mutationFn: (d: { bin?: string; dataDir?: string; modsDir?: string }) =>
      setFactorioPathsFn({ data: d }),
    onSuccess: () => {
      setDraft({});
      // paths feed the sync, launch button, companion installer, and drift checks
      void qc.invalidateQueries({ queryKey: ["factorioPaths"] });
      void qc.invalidateQueries({ queryKey: ["companionStatus"] });
      void qc.invalidateQueries({ queryKey: ["dataStatus"] });
      void qc.invalidateQueries({ queryKey: ["modDrift"] });
    },
  });
  const [draft, setDraft] = useState<Partial<Record<PathKey, string>>>({});

  const d = paths.data;
  if (!d) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Factorio paths</CardTitle>
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
          {FIELDS.map((f) => (
            <Skeleton key={f.key} className="h-14 w-full" />
          ))}
        </div>
      </Card>
    );
  }
  if (d.hidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Factorio paths</CardTitle>
        </CardHeader>
        <div className="px-3 pb-3 text-sm text-muted-foreground">
          Path settings are hidden for this instance.
        </div>
      </Card>
    );
  }

  const fieldValue = (key: PathKey) => draft[key] ?? d[key].stored;
  const dirty = FIELDS.some((f) => fieldValue(f.key) !== d[f.key].stored);
  const anyStored = FIELDS.some((f) => d[f.key].stored !== "");

  const saveAll = () => {
    const patch: Partial<Record<PathKey, string>> = {};
    for (const f of FIELDS) {
      if (fieldValue(f.key) !== d[f.key].stored) patch[f.key] = fieldValue(f.key);
    }
    save.mutate(patch);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Factorio paths</CardTitle>
        <InfoHint content="Where PyOps finds your Factorio install. Blank fields use the platform default; the FACTORIO_BIN / FACTORIO_DATA_DIR / FACTORIO_MODS_DIR env vars take priority when set." />
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        {FIELDS.map((f) => (
          <PathFieldRow
            key={f.key}
            label={f.label}
            hint={f.hint}
            env={f.env}
            field={d[f.key]}
            value={fieldValue(f.key)}
            onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={saveAll} disabled={!dirty || save.isPending}>
            Save paths
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => save.mutate({ bin: "", dataDir: "", modsDir: "" })}
            disabled={save.isPending || (!anyStored && !dirty)}
            className="text-muted-foreground"
          >
            Use platform defaults
          </Button>
        </div>
        {save.isError && (
          <p className="text-sm text-destructive">Save failed: {save.error.message}</p>
        )}
      </div>
    </Card>
  );
}

/** One path field: env-set fields show the winning value read-only; otherwise an
 * input whose placeholder is the platform default in effect when left blank. */
function PathFieldRow({
  label,
  hint,
  env,
  field,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  env: string;
  field: FactorioPathField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {field.source === "env" ? (
        <div className="mt-1 flex items-center gap-1 text-sm text-success">
          <Check className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate" title={field.effective}>
            Set via {env} env (wins): {field.effective}
          </span>
        </div>
      ) : (
        <Input
          value={value}
          placeholder={field.fallback}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full font-mono"
        />
      )}
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      {!field.exists && (
        <p className="text-sm break-all text-warning">Not found on disk: {field.effective}</p>
      )}
    </div>
  );
}
