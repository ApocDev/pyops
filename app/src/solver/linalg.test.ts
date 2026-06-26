import { describe, expect, it } from "vite-plus/test";
import { solveLeastSquares, solveSquare } from "./linalg.ts";

describe("solveSquare", () => {
  it("solves a 2×2 system", () => {
    // 2x + y = 5 ; x + 3y = 10  →  x = 1, y = 3
    const x = solveSquare(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(1);
    expect(x![1]).toBeCloseTo(3);
  });

  it("returns the empty solution for a 0×0 system", () => {
    expect(solveSquare([], [])).toEqual([]);
  });

  it("solves a system needing a pivot swap (zero leading entry)", () => {
    // first row has a 0 in column 0, forcing partial-pivot to swap rows
    const x = solveSquare(
      [
        [0, 1],
        [1, 0],
      ],
      [2, 3],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(3);
    expect(x![1]).toBeCloseTo(2);
  });

  it("returns null for a singular matrix", () => {
    // rows are linearly dependent (row2 = 2·row1) → no unique solution
    expect(
      solveSquare(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
  });

  it("returns null when dimensions are inconsistent", () => {
    expect(solveSquare([[1, 2]], [1])).toBeNull(); // 1×2 row in a square solver
    expect(
      solveSquare(
        [
          [1, 0],
          [0, 1],
        ],
        [1],
      ),
    ).toBeNull(); // b too short
  });

  it("solves the identity trivially", () => {
    const x = solveSquare(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [7, 8, 9],
    );
    expect(x).toEqual([7, 8, 9]);
  });
});

describe("solveLeastSquares", () => {
  it("solves a square system exactly with zero residual", () => {
    const r = solveLeastSquares(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(r).not.toBeNull();
    expect(r!.x[0]).toBeCloseTo(1);
    expect(r!.x[1]).toBeCloseTo(3);
    expect(r!.residual).toBeCloseTo(0);
  });

  it("solves an over-determined but consistent system (redundant row) with ~0 residual", () => {
    // 3 equations, 2 unknowns, but row3 = row1 + row2 → rank 2, consistent.
    // x = 1, y = 2 satisfies all three.
    const r = solveLeastSquares(
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [1, 2, 3],
    );
    expect(r).not.toBeNull();
    expect(r!.x[0]).toBeCloseTo(1);
    expect(r!.x[1]).toBeCloseTo(2);
    expect(r!.residual).toBeCloseTo(0);
  });

  it("reports a nonzero residual for an inconsistent over-determined system", () => {
    // x = 0 and x = 2 can't both hold; least-squares picks x = 1, residual 1.
    const r = solveLeastSquares([[1], [1]], [0, 2]);
    expect(r).not.toBeNull();
    expect(r!.x[0]).toBeCloseTo(1);
    expect(r!.residual).toBeCloseTo(1);
  });

  it("returns null for an under-determined system (fewer equations than unknowns)", () => {
    expect(solveLeastSquares([[1, 1]], [1])).toBeNull(); // m < n
  });

  it("returns null for an empty system", () => {
    expect(solveLeastSquares([], [])).toBeNull();
  });

  it("returns null when the column space is rank-deficient", () => {
    // both columns identical → AᵀA singular → no unique least-squares solution
    const r = solveLeastSquares(
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      [2, 4, 6],
    );
    expect(r).toBeNull();
  });
});
