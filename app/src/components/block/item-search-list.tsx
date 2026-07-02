import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchAllFn } from "../../server/factorio";
import { Icon } from "../../lib/icons";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { rowBtn } from "./styles.ts";

/** Searchable item+fluid list shared by the goal and block-icon pickers: a search
 * input over `searchAllFn` and a clickable result list. Search state lives here,
 * so it resets naturally when the dialog unmounts. */
export function ItemSearchList({
  prompt,
  current,
  onPick,
}: {
  /** hint shown before anything is typed */
  prompt: string;
  /** mark this item as the current pick, when set */
  current?: { kind: string; name: string } | null;
  onPick: (it: { kind: string; name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const items = useQuery({
    queryKey: ["bsearch", search],
    queryFn: () => searchAllFn({ data: search }),
    enabled: search.trim().length > 0,
  });
  return (
    <>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
        placeholder="search an item or fluid…"
      />
      <div className="max-h-[55vh] overflow-auto border border-border">
        {items.isLoading && (
          <div className="space-y-1.5 p-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        )}
        {!search.trim() ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{prompt}</div>
        ) : items.data?.length ? (
          items.data.map((it) => (
            <button
              key={`${it.kind}:${it.name}`}
              className={rowBtn}
              onClick={() => onPick(it)}
              title={it.display ?? it.name}
            >
              <Icon kind={it.kind as "item" | "fluid"} name={it.name} size="md" noTitle />
              <span className="truncate">{it.display ?? it.name}</span>
              {current?.kind === it.kind && current?.name === it.name && (
                <span className="text-sm text-primary">current</span>
              )}
            </button>
          ))
        ) : (
          !items.isLoading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">no matches</div>
          )
        )}
      </div>
    </>
  );
}
