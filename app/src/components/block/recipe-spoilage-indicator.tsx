import { Timer } from "lucide-react";

type Product = {
  name: string;
  kind: string;
};

/** Marks a recipe whose output items spoil. Spoilage belongs to the products,
 * not the recipe prototype, so the row derives this from its solved products
 * instead of teaching the shared recipe icon layer an ambiguous recipe→item
 * mapping. */
export function RecipeSpoilageIndicator({
  products,
  spoilables,
}: {
  products: readonly Product[];
  spoilables: Readonly<Record<string, number>>;
}) {
  const hasSpoilage = products.some(
    (product) => product.kind === "item" && spoilables[product.name] != null,
  );
  if (!hasSpoilage) return null;

  return (
    <>
      <span aria-hidden>·</span>
      <span
        role="img"
        aria-label="has spoilable products"
        data-recipe-spoilage
        className="flex shrink-0 items-center text-warning"
      >
        <Timer className="size-3.5" />
      </span>
    </>
  );
}
