import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import type { Goal } from "../../db/schema";
import { Icon } from "../../lib/icons";

/** A good the module can output — a candidate internal goal. */
export type GoalCandidate = { name: string; kind: "item" | "fluid"; display: string };

/** Internal-goals editor for a composed sub-block (#76). A module's goals are
 * HIDDEN from the factory — they size the module and pick which of its outputs is
 * the intended product; the parent then consumes that output like any recipe
 * product (forced co-products still export as byproducts). Pick one or more of the
 * module's net outputs and give each a target rate; the module is solved to meet
 * them, and the parent scales it to demand. */
export function GroupComposeDialog({
  name,
  candidates,
  current,
  onSave,
  onClose,
}: {
  /** the sub-block's display name (for the title) */
  name: string;
  /** goods the module produces (its net outputs) — the goals to choose from */
  candidates: GoalCandidate[];
  /** the module's current internal goals */
  current: Goal[];
  onSave: (goals: Goal[]) => void;
  onClose: () => void;
}) {
  // draft: per candidate, whether it's a goal and its rate string. Seeded from
  // the current goals; a candidate not yet a goal defaults to its 1/s.
  const [rows, setRows] = useState(() =>
    candidates.map((c) => {
      const g = current.find((x) => x.name === c.name);
      return { ...c, on: !!g, rate: g ? String(g.rate) : "1" };
    }),
  );
  const set = (nm: string, patch: Partial<{ on: boolean; rate: string }>) =>
    setRows((rs) => rs.map((r) => (r.name === nm ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="md:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle className="truncate">Module goals — {name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const goals: Goal[] = rows
              .filter((r) => r.on)
              .map((r) => ({ name: r.name, rate: Number(r.rate) }))
              .filter((g) => Number.isFinite(g.rate) && g.rate > 0);
            onSave(goals);
          }}
        >
          <p className="text-muted-foreground">
            Internal goals size this module. They stay hidden from the factory — the parent block
            consumes the output like a recipe product, and any forced co-product still exports as a
            byproduct.
          </p>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground">
              This sub-block has no outputs yet — add a recipe whose product leaves the chain.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <label
                  key={r.name}
                  className="flex items-center gap-2 px-1 py-0.5 hover:bg-muted/40"
                >
                  <Checkbox checked={r.on} onCheckedChange={(v) => set(r.name, { on: !!v })} />
                  <Icon kind={r.kind} name={r.name} size="sm" noHover noTitle />
                  <span className="min-w-0 flex-1 truncate">{r.display}</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={r.rate}
                    disabled={!r.on}
                    onChange={(e) => set(r.name, { rate: e.target.value })}
                    className="w-20 text-center"
                  />
                  <span className="text-muted-foreground">/s</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="outline" size="sm">
              save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
