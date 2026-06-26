/**
 * Solve a square linear system A·x = b by Gauss-Jordan elimination with partial
 * pivoting. Returns null if singular (under-determined / redundant). Small,
 * dependency-free — block systems are small and sparse.
 */
export function solveSquare(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  if (n === 0) return [];
  if (A.some((row) => row.length !== n) || b.length !== n) return null;

  // augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // partial pivot: largest magnitude in this column at/below the diagonal
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-9) return null; // singular
    [M[col], M[piv]] = [M[piv], M[col]];

    // eliminate this column from every other row
    const pivVal = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Solve A·x = b for an m×n system (m ≥ n) via the normal equations
 * (AᵀA)x = Aᵀb. Handles the redundant-but-consistent rows that cyclic recipe
 * chains produce (more balance equations than recipes, but rank n).
 * Returns the solution plus the max residual |Ax − b|; null if rank-deficient
 * (under-determined) or m < n.
 */
export function solveLeastSquares(
  A: number[][],
  b: number[],
): { x: number[]; residual: number } | null {
  const m = A.length;
  const n = m ? A[0].length : 0;
  if (n === 0 || m < n) return null;

  const AtA: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const Atb: number[] = Array.from({ length: n }, () => 0);
  for (let k = 0; k < m; k++) {
    const r = A[k];
    for (let i = 0; i < n; i++) {
      Atb[i] += r[i] * b[k];
      for (let j = 0; j < n; j++) AtA[i][j] += r[i] * r[j];
    }
  }

  const x = solveSquare(AtA, Atb);
  if (!x) return null;

  let residual = 0;
  for (let k = 0; k < m; k++) {
    let v = 0;
    for (let j = 0; j < n; j++) v += A[k][j] * x[j];
    residual = Math.max(residual, Math.abs(v - b[k]));
  }
  return { x, residual };
}
