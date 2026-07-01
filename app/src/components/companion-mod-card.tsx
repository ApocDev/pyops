import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  companionStatusFn,
  installCompanionFn,
  uninstallCompanionFn,
} from "../server/companion-mod-fns";
import type { CompanionPlatform, InstallMethod } from "../server/companion-mod";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Badge } from "#/components/ui/badge.tsx";

const PLATFORM_LABEL: Record<CompanionPlatform, string> = {
  linux: "Linux",
  mac: "macOS",
  windows: "Windows",
  other: "this OS",
};

/** Install the in-game companion mod by linking (recommended) or copying mod/
 * into the Factorio mods folder — OS-aware, no shell needed. */
export function CompanionModCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["companionStatus"], queryFn: () => companionStatusFn() });
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["companionStatus"] });
  const install = useMutation({
    mutationFn: (method: InstallMethod) => installCompanionFn({ data: { method } }),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const remove = useMutation({
    mutationFn: () => uninstallCompanionFn(),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const s = status.data;
  const busy = install.isPending || remove.isPending;

  const badge = !s ? null : !s.installed ? (
    <Badge variant="outline">not installed</Badge>
  ) : s.upToDate ? (
    <Badge className="bg-emerald-500/15 text-emerald-300">
      {s.method === "symlink" ? "linked" : "copied"}
    </Badge>
  ) : (
    <Badge variant="destructive">{s.method === "symlink" ? "broken link" : "out of date"}</Badge>
  );

  const symlinkLabel = s?.installed && s.method === "symlink" ? "Re-link" : "Symlink";
  const copyLabel = s?.installed && s.method === "copy" ? "Re-copy" : "Copy to mods dir";

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Companion mod</CardTitle>
        {badge}
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="text-muted-foreground">
          Installs the in-game bridge mod into your Factorio mods folder so the live panel, locate,
          and state sync work. Detected:{" "}
          <span className="text-foreground">{s ? PLATFORM_LABEL[s.platform] : "…"}</span>.
        </p>

        {s && (
          <div className="text-xs text-muted-foreground">
            mods folder: <span className="font-mono text-foreground">{s.modsDir}</span>
          </div>
        )}

        {s?.installed && (
          <div className="text-xs text-muted-foreground">
            {s.method === "symlink" ? (
              s.linkedToSource ? (
                <>
                  Linked to PyOps&apos; mod —{" "}
                  <span className="text-foreground">stays in sync as PyOps updates</span>.
                </>
              ) : (
                <span className="text-destructive">
                  The link doesn&apos;t point at PyOps&apos; mod folder — re-link to fix it.
                </span>
              )
            ) : s.upToDate ? (
              <>
                Copied v{s.installedVersion} —{" "}
                <span className="text-foreground">re-copy after updates</span>.
              </>
            ) : (
              <span className="text-destructive">
                Copied v{s.installedVersion ?? "?"}, PyOps is v{s.sourceVersion ?? "?"} — re-copy to
                update.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => install.mutate("symlink")}
            disabled={busy}
            title={
              s?.symlinkIsJunction
                ? "Create a directory junction (no admin needed) so the mod stays in sync with PyOps"
                : "Symlink PyOps' mod so it stays in sync"
            }
            className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          >
            {install.isPending && install.variables === "symlink"
              ? "linking…"
              : `${symlinkLabel} (recommended)`}
          </button>
          <button
            onClick={() => install.mutate("copy")}
            disabled={busy}
            title="Copy mod/ into the mods folder (a snapshot; re-copy after updates)"
            className="rounded border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50"
          >
            {install.isPending && install.variables === "copy" ? "copying…" : copyLabel}
          </button>
          {s?.installed && (
            <button
              onClick={() => remove.mutate()}
              disabled={busy}
              className="rounded border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
            >
              {remove.isPending ? "removing…" : "Remove"}
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {s?.method === "copy"
            ? "Installed as a copy — re-copy after PyOps updates to keep it in sync."
            : s?.symlinkIsJunction
              ? "On Windows the link is a directory junction (no admin or Developer Mode needed); it stays in sync as PyOps updates."
              : "The link points at PyOps' bundled mod, so it stays in sync as PyOps updates."}{" "}
          Then start the game from <span className="text-foreground">Live bridge</span> — the{" "}
          <span className="text-foreground">Launch Factorio</span> button sets the{" "}
          <span className="font-mono text-foreground">--enable-lua-udp</span> flag for you (or
          launch it yourself on a port other than the app&apos;s bridge port). The mod connects
          automatically — no in-game toggle.
        </p>

        {err && (
          <p className="rounded bg-destructive/15 px-2 py-1 text-xs text-destructive">{err}</p>
        )}
      </div>
    </Card>
  );
}
