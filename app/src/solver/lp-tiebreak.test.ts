import { expect, test, vi } from "vite-plus/test";

const solve = vi
  .fn()
  // Machine minimum: feasible, but it makes twice the requested product.
  .mockReturnValueOnce({ Status: "Optimal", Columns: { x0: { Primal: 1 } } })
  // Goal-surplus minimum: exact goal at half the recipe rate.
  .mockReturnValueOnce({
    Status: "Optimal",
    Columns: { x0: { Primal: 0.5 }, goalSlack0: { Primal: 0 } },
  })
  // Optional machine tie-break: simulate HiGHS rejecting the retained optimum.
  .mockReturnValueOnce({ Status: "Infeasible", Columns: {} });

vi.mock("highs", () => ({ default: vi.fn(async () => ({ solve })) }));

test("keeps the feasible goal optimum when the machine tie-break fails", async () => {
  const { solveBlockLp } = await import("./lp.ts");
  const result = await solveBlockLp({
    goals: [{ name: "product", rate: 1 }],
    recipes: [
      {
        name: "double-product",
        energyRequired: 1,
        ingredients: [],
        products: [{ kind: "item", name: "product", amount: 2 }],
      },
    ],
  });

  expect(result.status).toBe("solved");
  expect(result.recipes).toContainEqual(
    expect.objectContaining({ recipe: "double-product", rate: 0.5 }),
  );
  expect(solve).toHaveBeenCalledTimes(3);
});
