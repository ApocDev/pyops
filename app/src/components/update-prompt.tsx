import { useEffect, useRef, useState } from "react";
import { ArrowUpCircle, Download, Loader2, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { checkForUpdate, installUpdate, type UpdateInfo } from "../lib/updater";

/** Drop release-please's redundant "## [version] (date)" heading — the version is
 * already in the dialog header — while keeping the section subheadings + bullets. */
function changelogBody(notes: string | null): string {
  if (!notes) return "";
  return notes
    .split("\n")
    .filter((line) => !line.startsWith("## "))
    .join("\n")
    .trim();
}

/** Pull the release date (YYYY-MM-DD) out of release-please's "## [version] (date)"
 * heading and format it friendly, or null if it isn't there. */
function releaseDate(notes: string | null): string | null {
  const match = notes?.match(/^##\s.*\((\d{4}-\d{2}-\d{2})\)/m);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Self-update prompt for the desktop shell. Checks once on launch (via the Tauri
 * command, or a `?mockUpdate=` dev switch in the browser); if an update exists it pins
 * a small toast bottom-right that opens a changelog dialog with Install & Restart.
 * Inert in a plain browser. Mounted once in the root. */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false); // session-only; a restart re-checks
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return; // launch-only; no polling
    checked.current = true;
    checkForUpdate()
      .then((u) => {
        console.info("[updater] check:", u ? `update ${u.version} available` : "up to date");
        if (u) setUpdate(u);
      })
      .catch((err) => console.error("[updater] check failed", err));
  }, []);

  if (!update) return null;

  const dismiss = () => {
    setDismissed(true);
    setOpen(false);
  };

  const install = async () => {
    setInstalling(true);
    setProgress(0);
    try {
      await installUpdate(setProgress);
    } catch {
      // the real shell relaunches before this resolves; a failure just re-enables the
      // buttons so the user can retry.
      setInstalling(false);
    }
  };

  const pct = progress == null ? null : Math.round(progress * 100);
  const released = releaseDate(update.notes);

  return (
    <>
      {!dismissed && !open && (
        <div className="fixed right-4 bottom-4 z-50 flex max-w-xs items-start gap-2 border bg-card p-3 text-card-foreground shadow-lg">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-start gap-2.5 text-left"
          >
            <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">
                Update available — v{update.version}
              </span>
              <span className="block text-sm text-muted-foreground">Click to see what's new</span>
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={dismiss}
            aria-label="Dismiss until next launch"
            className="shrink-0 text-muted-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!installing) setOpen(v);
        }}
      >
        <DialogContent className="md:max-w-lg" showClose={!installing}>
          <DialogHeader className="h-auto flex-col items-start gap-0.5 py-2.5 pr-10">
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              PyOps {update.version} — you have {update.currentVersion}
              {released && <> · released {released}</>}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto p-4 text-sm [&_a]:text-primary [&_a]:underline [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
            <Markdown remarkPlugins={[remarkGfm]}>{changelogBody(update.notes)}</Markdown>
          </div>

          <DialogFooter>
            {installing ? (
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {pct == null ? "Downloading…" : `Downloading… ${pct}%`}
                </div>
                <div className="h-2 w-full overflow-hidden bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${pct ?? 15}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <Button variant="ghost" onClick={dismiss}>
                  Later
                </Button>
                <Button onClick={install}>
                  <Download className="size-4" />
                  Install &amp; Restart
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
