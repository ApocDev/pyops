/** When you add a recipe to consume a byproduct (clicking its surplus chip),
 * should the block DRAIN that good — pin it to net = 0 so the surplus MUST be
 * consumed in-block rather than vented — or only mark it made?
 *
 * Marking made alone forbids importing the good (the block-27 import-and-
 * restructure trap) but still lets any surplus leave as an export, so a pure
 * disposal recipe idles at 0 next to an untouched export. Draining forces it to
 * run. The catch: draining a consumer whose output RE-ENTERS the chain
 * restructures production (block 27's grade-2 → grade-3, which the chain then
 * consumes), which is not what "deal with my surplus" means.
 *
 * The line is the recipe's MAIN product: drain when the consumer net-consumes
 * the good and its purpose/output leaves the block. Secondary byproducts may
 * feed back into the chain (pitch → coke also returns several oils); that should
 * not stop the explicitly chosen consumer from running. A reprocessor whose
 * main output re-enters the chain still stays unforced. Recipes without a known
 * main product retain the conservative all-products-must-leave fallback. A
 * product that returns to an explicit sink goal is safe feedback: the sink still
 * fixes the block's purpose, so consuming the selected surplus cannot replace
 * that purpose with a cheaper internal loop. */
export function drainsOnConsume(opts: {
  good: string;
  mainProduct?: string | null;
  ingredients: readonly { name: string; amount?: number | null }[];
  products: readonly { name: string; amount?: number | null }[];
  consumedInBlock: ReadonlySet<string>;
  sinkGoals?: ReadonlySet<string>;
}): boolean {
  const { good, mainProduct, ingredients, products, consumedInBlock } = opts;
  const sinkGoals = opts.sinkGoals ?? new Set<string>();
  const sum = (arr: readonly { name: string; amount?: number | null }[], name: string) =>
    arr.filter((c) => c.name === name).reduce((s, c) => s + (c.amount ?? 0), 0);
  // a net producer of the good isn't a sink for it
  const netConsumes = sum(products, good) < sum(ingredients, good);
  const terminal = mainProduct
    ? mainProduct === good || !consumedInBlock.has(mainProduct) || sinkGoals.has(mainProduct)
    : products.every(
        (c) => c.name === good || !consumedInBlock.has(c.name) || sinkGoals.has(c.name),
      );
  return netConsumes && terminal;
}
