// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";

afterEach(cleanup); // vite-plus/test doesn't auto-wire RTL cleanup

describe("Button", () => {
  it("renders a <button> with default variant/size data attributes", () => {
    const { getByRole } = render(<Button>Click</Button>);
    const btn = getByRole("button");
    expect(btn.textContent).toBe("Click");
    expect(btn.getAttribute("data-slot")).toBe("button");
    expect(btn.getAttribute("data-variant")).toBe("default");
    expect(btn.getAttribute("data-size")).toBe("default");
  });

  it("reflects explicit variant and size", () => {
    const { getByRole } = render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    );
    const btn = getByRole("button");
    expect(btn.getAttribute("data-variant")).toBe("destructive");
    expect(btn.getAttribute("data-size")).toBe("sm");
  });

  it("fires onClick and respects disabled", () => {
    const onClick = vi.fn();
    const { getByRole, rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    expect(getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("renders as its child element when asChild is set (Slot)", () => {
    const { getByRole, queryByRole } = render(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>,
    );
    const link = getByRole("link");
    expect(link.getAttribute("href")).toBe("/x");
    // it's an <a>, not a <button>
    expect(queryByRole("button")).toBeNull();
    expect(link.getAttribute("data-slot")).toBe("button");
  });
});

describe("Badge", () => {
  it("defaults to the secondary variant and the badge data-slot", () => {
    const { getByText } = render(<Badge>New</Badge>);
    const badge = getByText("New");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.getAttribute("data-slot")).toBe("badge");
    expect(badge.className).toContain("bg-muted");
  });

  it("renders as its child when asChild is set", () => {
    const { getByRole } = render(
      <Badge asChild>
        <a href="/y">link-badge</a>
      </Badge>,
    );
    expect(getByRole("link").getAttribute("data-slot")).toBe("badge");
  });
});

describe("Tooltip", () => {
  it("renders the child as the trigger with no extra wrapper DOM", () => {
    const { getByRole } = render(
      <Tooltip content="explains the thing">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const btn = getByRole("button");
    expect(btn.textContent).toBe("trigger");
    // asChild: the trigger IS the button, not nested inside another element.
    expect(btn.hasAttribute("title")).toBe(false);
  });

  it("reveals the content on keyboard focus (accessible, unlike native title)", async () => {
    const { getByRole, findByRole } = render(
      <Tooltip content="explains the thing">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(getByRole("button"));
    const tip = await findByRole("tooltip");
    expect(tip.textContent).toContain("explains the thing");
  });

  it("renders the child alone when content is empty", () => {
    const { getByRole, queryByRole } = render(
      <Tooltip content={undefined}>
        <button type="button">bare</button>
      </Tooltip>,
    );
    expect(getByRole("button").textContent).toBe("bare");
    fireEvent.focus(getByRole("button"));
    expect(queryByRole("tooltip")).toBeNull();
  });
});
