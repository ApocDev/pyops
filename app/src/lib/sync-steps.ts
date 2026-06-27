import type { SyncPhase } from "../server/dump.ts";

/** A user-facing step in the guided dump flow. `iconsOnly` steps appear only when
 * the user opted to re-dump icon sprites (that stage loads the full game). */
export type SyncStep = { phase: SyncPhase; label: string; detail: string; iconsOnly?: boolean };

/** Ordered steps shown in the dump progress modal, in pipeline order. Mirrors the
 * `step()` phases in `server/dump.ts`. */
export const SYNC_STEPS: SyncStep[] = [
  { phase: "helper-mod", label: "Prepare dump helper", detail: "enable the pyops-dump mod" },
  { phase: "dump-data", label: "Dump prototype data", detail: "run factorio --dump-data" },
  { phase: "dump-locale", label: "Dump localization", detail: "names + descriptions" },
  {
    phase: "dump-icons",
    label: "Dump icon sprites",
    detail: "loads the full game — slow",
    iconsOnly: true,
  },
  { phase: "import", label: "Import into database", detail: "recipes, items, machines…" },
  {
    phase: "atlas",
    label: "Rebuild icon atlas",
    detail: "pack the sprite sheets",
    iconsOnly: true,
  },
  { phase: "costs", label: "Compute cost analysis", detail: "YAFC-style cost LP" },
  { phase: "migrations", label: "Apply mod renames", detail: "follow prototype renames" },
];

export type StepStatus = "done" | "active" | "pending" | "error";

/** The steps shown for a given run — drops the icon stages when icons weren't requested. */
export const stepsForRun = (icons: boolean): SyncStep[] =>
  SYNC_STEPS.filter((s) => icons || !s.iconsOnly);

/** Per-step status for the stepper, derived from the current sync phase. Steps
 * before the current phase are done, the current one is active, later ones pending;
 * `done` marks them all complete, and on error the failing step shows the error. */
export function stepStatuses(
  steps: SyncStep[],
  phase: SyncPhase,
  failedAt: SyncPhase | null,
): StepStatus[] {
  if (phase === "done") return steps.map(() => "done");
  const pivot =
    phase === "error"
      ? steps.findIndex((s) => s.phase === failedAt)
      : steps.findIndex((s) => s.phase === phase);
  return steps.map((_, i) => {
    if (pivot < 0) return "pending"; // idle, or a phase we don't render
    if (i < pivot) return "done";
    if (i > pivot) return "pending";
    return phase === "error" ? "error" : "active";
  });
}
