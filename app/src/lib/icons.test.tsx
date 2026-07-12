// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { Icon, IconProvider } from "./icons";

const { manifest } = vi.hoisted(() => ({
  manifest: {
    cell: 64,
    atlasSize: 4096,
    sheets: ["atlas-0.png"],
    icons: {
      "item/iron-plate": { s: 0, x: 3072, y: 3008 },
      "module/speed-module": { s: 0, x: 10, y: 20 }, // item-kind in a non-"item" folder
      "fluid/kerosene": { s: 0, x: 64, y: 128 },
    },
  },
}));

vi.mock("../server/factorio", () => ({
  iconManifestFn: () => Promise.resolve(manifest),
  spoilablesFn: () => Promise.resolve({}),
}));

// `noHover` renders the bare sprite (RawIcon) with its native title, which is
// where the slicing math lives; the default `Icon` wraps this in a hover card.
test("draws an item icon as a slice scaled off the size token", async () => {
  const { container } = render(
    <IconProvider>
      <Icon kind="item" name="iron-plate" size="sm" noHover />
    </IconProvider>,
  );
  await waitFor(() => {
    const span = container.querySelector("span[title='iron-plate']") as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.style.width).toBe("var(--icon-sm)");
    expect(span.style.backgroundImage).toContain("/icons/atlas-0.png");
    // positions/size are cell-multiples of the token: -(3072,3008)/64, 4096/64
    expect(span.getAttribute("style")).toContain(
      "calc(var(--icon-sm) * -48) calc(var(--icon-sm) * -47)",
    );
    expect(span.getAttribute("style")).toContain(
      "calc(var(--icon-sm) * 64) calc(var(--icon-sm) * 64)",
    );
  });
});

test("item-kind falls back to non-item folders (module/)", async () => {
  const { container } = render(
    <IconProvider>
      <Icon kind="item" name="speed-module" size="md" noHover />
    </IconProvider>,
  );
  await waitFor(() => {
    const span = container.querySelector("span[title='speed-module']") as HTMLElement;
    expect(span.getAttribute("style")).toContain(
      "calc(var(--icon-md) * -0.15625) calc(var(--icon-md) * -0.3125)",
    );
  });
});

test("fluid-fuel conversion recipes use the source fluid icon with a fuel badge", async () => {
  const { container } = render(
    <IconProvider>
      <Icon kind="recipe" name="burn-fluid-kerosene" size="md" noHover />
    </IconProvider>,
  );
  await waitFor(() => {
    const span = container.querySelector("span[title='burn-fluid-kerosene']") as HTMLElement;
    expect(span.getAttribute("style")).toContain(
      "calc(var(--icon-md) * -1) calc(var(--icon-md) * -2)",
    );
    expect(container.querySelector("[data-icon-badge='fluid-fuel'] svg")).toBeTruthy();
  });
});

test("the default icon shows no internal-name title (a rich hover card replaces it)", async () => {
  const { container } = render(
    <IconProvider>
      <Icon kind="item" name="iron-plate" size="sm" />
    </IconProvider>,
  );
  await waitFor(() => {
    expect(container.querySelector("span[style*='background-image']")).toBeTruthy();
  });
  expect(
    container.querySelector("[data-good-name='iron-plate'][data-good-kind='item']"),
  ).toBeTruthy();
  // the sprite no longer leaks the internal name as a native tooltip
  expect(container.querySelector("[title='iron-plate']")).toBeNull();
});
