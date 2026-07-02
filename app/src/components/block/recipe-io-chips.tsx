import { ItemHover } from "../../lib/recipe-card";
import { Icon } from "../../lib/icons";
import { fmtAmt } from "./format.ts";

/** A recipe's io at a glance — "ingredients → products" as icon+amount chips,
 * each hoverable for the rich item card. Used by the recipe-picker rows. */
export function RecipeIoChips({
  ingredients,
  products,
}: {
  ingredients: { name: string; kind: string; amount: number }[];
  products: { name: string; kind: string; amount: number }[];
}) {
  const chips = (list: { name: string; kind: string; amount: number }[], prefix: string) =>
    list.map((c, i) => (
      <ItemHover
        key={`${prefix}${i}`}
        name={c.name}
        kind={c.kind as "item" | "fluid"}
        className="flex items-center gap-1"
      >
        <Icon kind={c.kind as "item" | "fluid"} name={c.name} size="sm" noHover />
        <span className="text-sm text-muted-foreground">{fmtAmt(c.amount)}</span>
      </ItemHover>
    ));
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {chips(ingredients, "i")}
      <span className="text-muted-foreground">→</span>
      {chips(products, "p")}
    </span>
  );
}
