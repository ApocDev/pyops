import { expect, test } from "vite-plus/test";
import {
  groupNet,
  groupSpan,
  joinGroup,
  leaveGroup,
  moveGroupSpan,
  normalizeGroups,
  resolveGroupAfterMove,
  type GroupAssign,
} from "./row-groups.ts";

const R = ["a", "b", "c", "d", "e"];

test("groupSpan finds the contiguous span, null when empty", () => {
  const assign: GroupAssign = { b: 1, c: 1 };
  expect(groupSpan(R, assign, 1)).toEqual([1, 2]);
  expect(groupSpan(R, assign, 9)).toBeNull();
});

test("joinGroup assigns and moves the row to the end of the span", () => {
  const { recipes, assign } = joinGroup(R, { b: 1, c: 1 }, "e", 1);
  expect(recipes).toEqual(["a", "b", "c", "e", "d"]);
  expect(assign.e).toBe(1);
});

test("joinGroup with no other members only assigns", () => {
  const { recipes, assign } = joinGroup(R, {}, "c", 1);
  expect(recipes).toEqual(R);
  expect(assign.c).toBe(1);
});

test("leaveGroup clears the assignment and nothing else", () => {
  const next = leaveGroup({ b: 1, c: 1 }, "b");
  expect(next).toEqual({ c: 1 });
  expect(leaveGroup(next, "zzz")).toBe(next); // no-op returns same ref
});

test("resolveGroupAfterMove: inside a span adopts the group", () => {
  // c was moved between b and d, both in group 1
  const assign = resolveGroupAfterMove(["a", "b", "c", "d", "e"], { b: 1, d: 1 }, "c");
  expect(assign.c).toBe(1);
});

test("resolveGroupAfterMove: at the edge of its own group stays", () => {
  const assign: GroupAssign = { b: 1, c: 1 };
  expect(resolveGroupAfterMove(["a", "c", "b", "d", "e"], assign, "b")).toBe(assign);
});

test("resolveGroupAfterMove: away from any span ungroups", () => {
  const assign = resolveGroupAfterMove(["a", "d", "e", "b", "c"], { b: 1, c: 1, e: 2 }, "c");
  // c now sits after b (own group) — stays; move it truly away instead:
  expect(assign.c).toBe(1);
  const away = resolveGroupAfterMove(["c", "a", "d", "e", "b"], { b: 1, c: 1, e: 2 }, "c");
  expect(away.c).toBeUndefined();
});

test("moveGroupSpan relocates the whole span as a unit", () => {
  const assign: GroupAssign = { b: 1, c: 1 };
  // rest (without span) = [a, d, e]; target 2 → insert before e
  expect(moveGroupSpan(R, assign, 1, 2)).toEqual(["a", "d", "b", "c", "e"]);
  expect(moveGroupSpan(R, assign, 1, 0)).toEqual(["b", "c", "a", "d", "e"]);
});

test("normalizeGroups drops orphans and makes members contiguous", () => {
  const { recipes, groups, assign } = normalizeGroups(
    ["a", "b", "x", "c", "d"],
    [
      { id: 1, name: "chain" },
      { id: 2, name: "empty" },
    ],
    { b: 1, c: 1, gone: 1, d: 9 },
  );
  expect(recipes).toEqual(["a", "b", "c", "x", "d"]); // c pulled up behind b
  expect(groups).toEqual([{ id: 1, name: "chain" }]); // empty group 2 dropped
  expect(assign).toEqual({ b: 1, c: 1 }); // gone/unknown-group assigns dropped
});

test("groupNet cancels intermediates, leaving chain inputs/outputs + totals", () => {
  const rows = [
    {
      recipe: "smelt",
      ingredients: [{ name: "ore", kind: "item", rate: 4 }],
      products: [{ name: "plate", kind: "item", rate: 2 }],
      machine: { count: 3, powerW: 100, energySource: "electric" },
    },
    {
      recipe: "gear",
      ingredients: [{ name: "plate", kind: "item", rate: 2 }],
      products: [{ name: "gear", kind: "item", rate: 1 }],
      machine: { count: 1.5, powerW: 50, energySource: "burner" },
    },
    {
      recipe: "outsider",
      ingredients: [{ name: "gear", kind: "item", rate: 99 }],
      products: [],
      machine: { count: 100, powerW: 1e6, energySource: "electric" },
    },
  ];
  const net = groupNet(rows, new Set(["smelt", "gear"]));
  expect(net.inputs).toEqual([{ name: "ore", kind: "item", rate: 4 }]);
  expect(net.outputs).toEqual([{ name: "gear", kind: "item", rate: 1 }]); // plate cancelled
  expect(net.machines).toBe(4.5);
  expect(net.powerW).toBe(100); // burner machines draw no electric power
});
