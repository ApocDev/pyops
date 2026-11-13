// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  dismissFocusedEntity,
  useFocusedEntity,
  usePageEntity,
  type PageEntity,
} from "./page-context";

afterEach(cleanup);

const block = (id: string, label: string): PageEntity => ({ kind: "block", id, label });

/** A page offering `entity` plus the dock reading it, in one hook. */
const renderPage = (entity: PageEntity) =>
  renderHook(
    ({ entity }) => {
      usePageEntity(entity);
      return useFocusedEntity();
    },
    { initialProps: { entity } },
  );

describe("page context dismissal", () => {
  it("stays dismissed across a rename and resets for a different entity", () => {
    const page = renderPage(block("7", "Iron plate"));
    expect(page.result.current?.label).toBe("Iron plate");

    act(() => dismissFocusedEntity());
    expect(page.result.current).toBeNull();

    // renaming the same block re-runs the page's effect; the chip stays gone
    page.rerender({ entity: block("7", "Iron plate (fast)") });
    expect(page.result.current).toBeNull();

    // another block is a new entity: its chip shows
    page.rerender({ entity: block("8", "Copper plate") });
    expect(page.result.current?.label).toBe("Copper plate");
  });
});
