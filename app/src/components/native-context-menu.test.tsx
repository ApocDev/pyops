// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { NativeContextMenu } from "./native-context-menu";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function openContextMenu(): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

test("suppresses the platform context menu by default", () => {
  const view = render(<NativeContextMenu />);
  expect(openContextMenu().defaultPrevented).toBe(true);

  view.unmount();
  expect(openContextMenu().defaultPrevented).toBe(false);
});

test("allows the platform context menu through the debug override", () => {
  vi.stubEnv("VITE_PYOPS_NATIVE_CONTEXT_MENU", "true");
  render(<NativeContextMenu />);
  expect(openContextMenu().defaultPrevented).toBe(false);
});
