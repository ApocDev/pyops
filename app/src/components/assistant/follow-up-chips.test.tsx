// @vitest-environment jsdom
/**
 * One-click follow-ups (#13): the draft-card chips send the matching chat
 * request — "Draft <good> @ rate" for a suggested sub-block, "Route <good>"
 * for a byproduct — with localized labels and the internal name in the prompt.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { IconProvider } from "#/lib/icons";
import { FollowUpChips, followUpPrompt } from "./follow-up-chips.tsx";

afterEach(cleanup);

// stub the server fns (no db in component tests); classifyRef resolves a display
vi.mock("#/server/factorio", () => ({
  iconManifestFn: () => Promise.resolve({ cell: 64, atlasSize: 4096, sheets: [], icons: {} }),
  spoilablesFn: () => Promise.resolve({}),
  classifyRefFn: ({ data }: { data: { name: string } }) =>
    Promise.resolve(data.name === "super-alloy" ? { kind: "item", display: "Super alloy" } : null),
}));

function withProviders(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IconProvider>{ui}</IconProvider>
    </QueryClientProvider>,
  );
}

describe("followUpPrompt", () => {
  it("phrases a sub-block draft with the internal name and solved rate", () => {
    expect(followUpPrompt({ kind: "draft", good: "super-alloy", rate: 3.3 })).toBe(
      "Draft a block: super-alloy @ 3.3/s.",
    );
  });
  it("asks for sizing when the solve produced no rate", () => {
    expect(followUpPrompt({ kind: "draft", good: "super-alloy", rate: null })).toMatch(
      /sized to my factory's demand/,
    );
  });
  it("phrases byproduct routing via byproductSinks language", () => {
    const p = followUpPrompt({ kind: "route", good: "tailings", rate: 2 });
    expect(p).toContain("tailings");
    expect(p).toContain("2/s");
    expect(p).toMatch(/consuming recipe|importing block|void/);
  });
});

describe("FollowUpChips", () => {
  it("sends the draft prompt on click and shows the localized name", async () => {
    const onFollowUp = vi.fn();
    const { findByText, getByText } = withProviders(
      <FollowUpChips
        followUps={[{ kind: "draft", good: "super-alloy", rate: 3.3 }]}
        onFollowUp={onFollowUp}
      />,
    );
    // localized display, not the internal id, once the ref resolves
    expect(await findByText(/Super alloy/)).toBeTruthy();
    fireEvent.click(getByText(/Draft/));
    expect(onFollowUp).toHaveBeenCalledWith("Draft a block: super-alloy @ 3.3/s.");
  });

  it("disables the chips while the assistant is busy", () => {
    const onFollowUp = vi.fn();
    const { getByRole } = withProviders(
      <FollowUpChips
        followUps={[{ kind: "route", good: "tailings", rate: 2 }]}
        disabled
        onFollowUp={onFollowUp}
      />,
    );
    const btn = getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  it("renders nothing without a send handler or entries", () => {
    const empty = withProviders(<FollowUpChips followUps={[]} onFollowUp={() => {}} />);
    expect(empty.container.textContent).toBe("");
    const noHandler = withProviders(<FollowUpChips followUps={[{ kind: "draft", good: "x" }]} />);
    expect(noHandler.container.textContent).toBe("");
  });
});
