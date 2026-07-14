/** Adding a consumer through a byproduct's surplus chip is an explicit link:
 * drain that good (net = 0) whenever the selected recipe really net-consumes
 * it. This applies to terminal sinks and feedback recyclers alike. The `made`
 * mark added by the same gesture forbids importing the byproduct, while the
 * drain makes the selected route participate instead of leaving the recipe at
 * zero under the machine-minimizing objective. */
export function drainsOnConsume(opts: {
  good: string;
  ingredients: readonly { name: string; amount?: number | null }[];
  products: readonly { name: string; amount?: number | null }[];
}): boolean {
  const { good, ingredients, products } = opts;
  const sum = (arr: readonly { name: string; amount?: number | null }[], name: string) =>
    arr.filter((c) => c.name === name).reduce((s, c) => s + (c.amount ?? 0), 0);
  return sum(products, good) < sum(ingredients, good);
}
