import { describe, expect, it } from "vite-plus/test";

import {
  dismissToast,
  pushToast,
  TOAST_CAP,
  TOAST_DURATION_DEFAULT,
  toast,
  toastStore,
  type ToastEntry,
} from "./toast-store";

const entry = (id: number): ToastEntry => ({
  id,
  message: `toast ${id}`,
  tone: "default",
  duration: TOAST_DURATION_DEFAULT,
});

describe("pushToast", () => {
  it("appends to the end (newest last)", () => {
    const q = pushToast(pushToast([], entry(1)), entry(2));
    expect(q.map((t) => t.id)).toEqual([1, 2]);
  });

  it("drops the oldest entries beyond the cap", () => {
    let q: ToastEntry[] = [];
    for (let i = 1; i <= TOAST_CAP + 2; i++) q = pushToast(q, entry(i));
    expect(q).toHaveLength(TOAST_CAP);
    expect(q[0].id).toBe(3); // 1 and 2 fell off
    expect(q.at(-1)?.id).toBe(TOAST_CAP + 2);
  });

  it("does not mutate the input queue", () => {
    const q = [entry(1)];
    pushToast(q, entry(2));
    expect(q).toHaveLength(1);
  });
});

describe("dismissToast", () => {
  it("removes the matching toast and keeps the rest in order", () => {
    const q = [entry(1), entry(2), entry(3)];
    expect(dismissToast(q, 2).map((t) => t.id)).toEqual([1, 3]);
  });

  it("returns the same array when the id is already gone", () => {
    const q = [entry(1)];
    expect(dismissToast(q, 99)).toBe(q);
  });
});

describe("toast()", () => {
  it("assigns increasing ids and applies defaults", () => {
    toastStore.setState(() => []);
    const a = toast({ message: "first" });
    const b = toast({ message: "second", tone: "success", duration: 1000 });
    expect(b).toBeGreaterThan(a);
    const q = toastStore.state;
    expect(q.map((t) => t.message)).toEqual(["first", "second"]);
    expect(q[0].tone).toBe("default");
    expect(q[0].duration).toBe(TOAST_DURATION_DEFAULT);
    expect(q[1].tone).toBe("success");
    expect(q[1].duration).toBe(1000);
    toastStore.setState(() => []);
  });
});
