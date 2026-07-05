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
 * The line is TERMINALITY: drain only when the consumer net-consumes the good
 * AND none of its other products feeds anything else in the block — everything
 * it makes leaves. A void (coal-gas → ash, nothing here uses ash) qualifies; a
 * reprocessor does not. `consumedInBlock` is the set of goods the block's other
 * recipes consume, read from the current solve (the block before this add), so
 * a terminal product that only starts leaving after the add still reads right. */
export function drainsOnConsume(opts: {
  good: string;
  ingredients: readonly { name: string; amount?: number | null }[];
  products: readonly { name: string; amount?: number | null }[];
  consumedInBlock: ReadonlySet<string>;
}): boolean {
  const { good, ingredients, products, consumedInBlock } = opts;
  const sum = (arr: readonly { name: string; amount?: number | null }[], name: string) =>
    arr.filter((c) => c.name === name).reduce((s, c) => s + (c.amount ?? 0), 0);
  // a net producer of the good isn't a sink for it
  const netConsumes = sum(products, good) < sum(ingredients, good);
  // every other product leaves the block (nothing else consumes it)
  const terminal = products.every((c) => c.name === good || !consumedInBlock.has(c.name));
  return netConsumes && terminal;
}
