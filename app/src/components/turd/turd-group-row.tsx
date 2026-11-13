import type { CSSProperties } from "react";
import { Boxes, Check, ChevronRight } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Icon } from "#/lib/icons.tsx";
import { cn } from "#/lib/utils.ts";
import type { TurdBoardGroup, TurdBoardOption } from "#/server/turd-board.server.ts";
import { TurdOptionCard, type TurdSections } from "./turd-option-card.tsx";

/** How many distinct blocks any option of a group touches. */
export const groupBlockCount = (g: TurdBoardGroup) =>
  new Set(g.subTechs.flatMap((s) => s.blocks.map((b) => b.id))).size;

/** One TURD group in the accordion: a compact summary row (chosen option, the
 * options' icons, how many of the player's blocks it touches, science), which
 * expands in place into the options side by side. */
export function TurdGroupRow({
  group: g,
  open,
  onToggle,
  disabled,
  onChoose,
  onClear,
}: {
  group: TurdBoardGroup;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  onChoose: (option: TurdBoardOption) => void;
  onClear: (option: TurdBoardOption) => void;
}) {
  const chosen = g.subTechs.find((s) => s.name === g.selected);
  const blockCount = groupBlockCount(g);
  const blockNames = [...new Set(g.subTechs.flatMap((s) => s.blocks.map((b) => b.name)))];
  const sections: TurdSections = {
    module: g.subTechs.some((s) => s.modules.length > 0),
    swaps: g.subTechs.some((s) => s.changes.some((c) => c.from)),
    unlocks: g.subTechs.some((s) => s.changes.some((c) => !c.from)),
  };
  // header + optional sections + blocks + actions, shared by every option's subgrid
  const rows = 3 + Object.values(sections).filter(Boolean).length;
  const cols = Math.min(g.subTechs.length, 4);

  const state = chosen ? (
    <Badge
      variant="outline"
      className="max-w-full border-success/40 bg-success/15 text-success"
      title={chosen.display}
    >
      <Check />
      <span className="truncate">{chosen.display}</span>
    </Badge>
  ) : (
    <span className="flex items-center gap-1">
      {g.subTechs.map((s) => (
        <Icon key={s.name} kind="technology" name={s.name} size="sm" />
      ))}
    </span>
  );
  const blocks = blockCount > 0 && (
    <Badge
      variant="outline"
      className="border-info/40 bg-info/15 text-info"
      title={blockNames.join("\n")}
    >
      <Boxes /> {blockCount}
    </Badge>
  );

  return (
    <div
      data-testid="turd-group"
      data-group={g.name}
      data-chosen={chosen ? "" : undefined}
      className={cn(chosen && "border-l-2 border-l-success", open && "bg-card")}
    >
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={onToggle}
        className="grid h-auto w-full grid-cols-[auto_auto_minmax(0,1fr)] justify-items-start gap-x-3 px-3 py-1.5 text-left font-normal whitespace-normal lg:grid-cols-[auto_auto_minmax(12rem,1.2fr)_minmax(0,1.4fr)_4rem_auto]"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-90 text-primary",
          )}
        />
        <Icon kind="technology" name={g.name} size="md" noHover />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-semibold" title={g.display}>
            {g.display}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 lg:hidden">
            {state}
            {blocks}
          </span>
        </span>
        <span className="hidden min-w-0 lg:flex">{state}</span>
        <span className="hidden lg:flex">{blocks}</span>
        <span className="hidden items-center gap-1 justify-self-end lg:flex">
          {g.science.map((s) => (
            <Icon key={s.name} kind="item" name={s.name} size="sm" />
          ))}
        </span>
      </Button>
      {open && (
        <div
          className="grid gap-2 border-t border-border p-3 lg:grid-cols-(--turd-cols)"
          style={
            {
              "--turd-cols": `repeat(${cols}, minmax(0, 1fr))`,
              "--turd-rows": rows,
            } as CSSProperties
          }
        >
          {g.subTechs.map((s) => (
            <TurdOptionCard
              key={s.name}
              option={s}
              sections={sections}
              chosen={s.name === g.selected}
              disabled={disabled}
              onChoose={() => onChoose(s)}
              onClear={() => onClear(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
