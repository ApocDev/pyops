/**
 * Machine-count rendering helpers. Block solves report machine counts that are
 * either fractional (the default solve — 7.28 assemblers is the exact ratio) or
 * integer (from the game's built counts) — both flow into the factory machines
 * table, so it renders each sanely: integers plain, fractions at adaptive
 * precision with the whole-machine build target alongside.
 */
import { formatQty } from "./format";

/** Whole machines you must place to cover a (possibly fractional) requirement. */
export const wholeMachines = (n: number): number => Math.ceil(n - 1e-6);

/** True when a count is (numerically) a whole number — the game's built-count
 * blocks and built counts from the game; fractional solves are not. */
export const isWholeCount = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-6;

/** Count text: integers plain ("8"), fractional at adaptive precision ("7.28"). */
export const fmtMachineCount = (n: number): string =>
  isWholeCount(n) ? String(Math.round(n)) : formatQty(n);
