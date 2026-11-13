import { useState, type KeyboardEvent } from "react";
import { Boxes } from "lucide-react";
import { RawIcon } from "../../../lib/icons";
import { useFilteredList } from "../../../lib/use-filtered-list";
import { Button } from "#/components/ui/button.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { cn } from "#/lib/utils.ts";
import type { FocusTarget } from "./focus-graph.ts";

export type SearchEntry =
  | { type: "good"; good: string; display: string; kind: "item" | "fluid" }
  | { type: "block"; id: number; name: string; iconKind: string | null; iconName: string | null };

const PER_GROUP = 6;

const keys = {
  display: (e: SearchEntry) => (e.type === "good" ? e.display : e.name),
  internal: (e: SearchEntry) => (e.type === "good" ? e.good : null),
};

const targetOf = (e: SearchEntry): FocusTarget =>
  e.type === "good" ? { kind: "good", good: e.good } : { kind: "block", id: e.id };

/** Type-ahead over the board's goods and blocks; picking one focuses the board
 * on it. Arrow keys move, Enter picks, Escape closes. */
export function BoardSearch({
  entries,
  onPick,
  className,
}: {
  entries: SearchEntry[];
  onPick: (target: FocusTarget) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const matches = useFilteredList(entries, query, keys);
  const goods = matches.filter((e) => e.type === "good").slice(0, PER_GROUP);
  const blocks = matches.filter((e) => e.type === "block").slice(0, PER_GROUP);
  const options = query.trim() === "" ? [] : [...goods, ...blocks];
  const shown = open && options.length > 0;

  const pick = (e: SearchEntry) => {
    onPick(targetOf(e));
    setQuery("");
    setOpen(false);
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") setOpen(false);
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      setOpen(true);
      const step = ev.key === "ArrowDown" ? 1 : -1;
      setCursor((c) => (options.length ? (c + step + options.length) % options.length : 0));
    } else if (ev.key === "Enter" && shown) pick(options[Math.min(cursor, options.length - 1)]);
  };

  return (
    <div
      className={cn("relative", className)}
      onKeyDown={onKeyDown}
      onBlur={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget)) setOpen(false);
      }}
    >
      <FilterInput
        value={query}
        onValueChange={(v) => {
          setQuery(v);
          setCursor(0);
          setOpen(true);
        }}
        placeholder="Focus a block or good…"
      />
      {shown && (
        <div
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-96 overflow-y-auto border border-border bg-popover shadow-md"
        >
          {(
            [
              ["Goods", goods],
              ["Blocks", blocks],
            ] as const
          ).map(
            ([label, group]) =>
              group.length > 0 && (
                <div key={label}>
                  <div className="px-2 pt-1.5 text-sm text-muted-foreground">{label}</div>
                  {group.map((e) => {
                    const i = options.indexOf(e);
                    const name = e.type === "good" ? e.display : e.name;
                    return (
                      <Button
                        key={e.type === "good" ? `g:${e.good}` : `b:${e.id}`}
                        role="option"
                        aria-selected={i === cursor}
                        variant="ghost"
                        onClick={() => pick(e)}
                        onMouseMove={() => setCursor(i)}
                        className={cn(
                          "w-full justify-start gap-2 font-normal",
                          i === cursor && "bg-muted",
                        )}
                      >
                        {e.type === "good" ? (
                          <RawIcon kind={e.kind} name={e.good} size="sm" noTitle />
                        ) : e.iconKind && e.iconName ? (
                          <RawIcon
                            kind={e.iconKind as "item" | "fluid" | "recipe"}
                            name={e.iconName}
                            size="sm"
                            noTitle
                          />
                        ) : (
                          <Boxes className="text-muted-foreground" aria-hidden />
                        )}
                        <span className="truncate">{name}</span>
                      </Button>
                    );
                  })}
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
