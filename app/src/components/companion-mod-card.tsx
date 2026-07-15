import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  companionStatusFn,
  installCompanionFn,
  uninstallCompanionFn,
} from "../server/companion-mod-fns";
import type { CompanionPlatform, InstallMethod } from "../server/companion-mod.server.ts";
import { toast } from "../lib/toast-store";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";

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
  // Remove goes through a confirm dialog (#83) — it isn't in the undo log, so
  // the post-remove toast has no Undo button.
  const [confirmRemove, setConfirmRemove] = useState(false);

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
      toast({ message: "Companion mod removed from the Factorio mods folder" });
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const s = status.data;
  const busy = install.isPending || remove.isPending;

  const badge = !s ? null : !s.installed ? (
    <Badge variant="outline">Not installed</Badge>
  ) : s.upToDate ? (
    <Badge className="border-transparent bg-success/15 text-success">
      {s.method === "symlink" ? "Linked" : "Copied"}
    </Badge>
  ) : (
    <Badge variant="destructive">{s.method === "symlink" ? "Broken link" : "Out of date"}</Badge>
  );

  const symlinkLabel = s?.installed && s.method === "symlink" ? "Re-link" : "Symlink";
  const copyLabel = s?.installed && s.method === "copy" ? "Re-copy" : "Copy to mods dir";

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Companion mod</CardTitle>
        <span className="flex items-center gap-2">
          {badge}
          <HelpButton title="Companion mod">
            <p>
              PyOps talks to a running game through a small companion mod. Installing it into your
              Factorio mods folder enables the in-game panel, locate-in-game, live state sync, and
              the data dump.
            </p>
            <p>
              <span className="text-foreground">Symlink (recommended)</span> links PyOps&apos;
              bundled mod in place, so it stays in sync as PyOps updates. On Windows the link is a
              directory junction — no admin or Developer Mode needed.
            </p>
            <p>
              <span className="text-foreground">Copy</span> places a snapshot in the mods folder —
              re-copy after PyOps updates to keep it in sync.
            </p>
            <p>
              Then start the game from <span className="text-foreground">Live bridge</span> — the{" "}
              <span className="text-foreground">Launch Factorio</span> button sets the{" "}
              <span className="font-mono text-foreground">--enable-lua-udp</span> flag for you. Or
              launch it yourself with that flag on any free port <em>other</em> than the app&apos;s
              bridge port (Factorio binds its port itself and can&apos;t share), leaving the
              mod&apos;s bridge-port setting at the app&apos;s port. The mod connects automatically
              — no in-game toggle.
            </p>
          </HelpButton>
        </span>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="text-muted-foreground">
          Detected: <span className="text-foreground">{s ? PLATFORM_LABEL[s.platform] : "…"}</span>.
        </p>

        {s && (
          <div className="text-sm text-muted-foreground">
            Mods folder: <span className="font-mono text-foreground">{s.modsDir}</span>
          </div>
        )}

        {s?.installed && (
          <div className="text-sm text-muted-foreground">
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
          <Button
            onClick={() => install.mutate("symlink")}
            disabled={busy}
            title={
              s?.symlinkIsJunction
                ? "Create a directory junction (no admin needed) so the mod stays in sync with PyOps"
                : "Symlink PyOps' mod so it stays in sync"
            }
          >
            {install.isPending && install.variables === "symlink"
              ? "Linking…"
              : `${symlinkLabel} (recommended)`}
          </Button>
          <Button
            variant="outline"
            onClick={() => install.mutate("copy")}
            disabled={busy}
            title="Copy mod/ into the mods folder (a snapshot; re-copy after updates)"
          >
            {install.isPending && install.variables === "copy" ? "Copying…" : copyLabel}
          </Button>
          {s?.installed && (
            <Button
              variant="outline"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          )}
          <ConfirmDialog
            open={confirmRemove}
            onOpenChange={setConfirmRemove}
            title="Remove companion mod"
            description={`Remove the ${s?.method === "symlink" ? "link to PyOps' mod" : "copied mod"} from the Factorio mods folder? The in-game panel, live bridge, and data sync stop working until you reinstall it (one click here).`}
            confirmLabel="Remove mod"
            onConfirm={() => {
              setConfirmRemove(false);
              remove.mutate();
            }}
          />
        </div>

        {err && <Callout tone="destructive">{err}</Callout>}
      </div>
    </Card>
  );
}
