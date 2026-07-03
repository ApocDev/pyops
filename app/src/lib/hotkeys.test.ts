// @vitest-environment jsdom
import { describe, expect, it, vi } from "vite-plus/test";
import {
  activeHotkeys,
  dispatchKeydown,
  isEditableTarget,
  matchesCombo,
  parseCombo,
  registerHotkey,
  type KeyLike,
} from "./hotkeys";

const key = (k: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("parseCombo", () => {
  it("parses modifier combos in any order and case", () => {
    expect(parseCombo("Ctrl+Shift+Z")).toEqual({
      key: "z",
      ctrl: true,
      meta: false,
      alt: false,
      shift: true,
      mod: false,
    });
    expect(parseCombo("mod+k").mod).toBe(true);
    expect(parseCombo("cmd+k").meta).toBe(true);
  });

  it("parses a bare key, including '/'", () => {
    expect(parseCombo("/")).toMatchObject({ key: "/", ctrl: false, shift: false });
    expect(parseCombo("Escape").key).toBe("escape");
  });

  it("rejects empty and double-key combos", () => {
    expect(() => parseCombo("ctrl+")).toThrow(/no key/);
    expect(() => parseCombo("a+b")).toThrow(/more than one key/);
  });
});

describe("matchesCombo", () => {
  it("resolves mod to Ctrl on non-mac and Cmd on mac", () => {
    const combo = parseCombo("mod+k");
    expect(matchesCombo(key("k", { ctrlKey: true }), combo, false)).toBe(true);
    expect(matchesCombo(key("k", { metaKey: true }), combo, false)).toBe(false);
    expect(matchesCombo(key("k", { metaKey: true }), combo, true)).toBe(true);
    expect(matchesCombo(key("k", { ctrlKey: true }), combo, true)).toBe(false);
    expect(matchesCombo(key("k"), combo, false)).toBe(false);
  });

  it("requires exact modifiers once any is declared", () => {
    const combo = parseCombo("ctrl+k");
    expect(matchesCombo(key("k", { ctrlKey: true, shiftKey: true }), combo, false)).toBe(false);
    expect(matchesCombo(key("k", { ctrlKey: true, altKey: true }), combo, false)).toBe(false);
    const shifted = parseCombo("ctrl+shift+z");
    expect(matchesCombo(key("z", { ctrlKey: true, shiftKey: true }), shifted, false)).toBe(true);
    expect(matchesCombo(key("z", { ctrlKey: true }), shifted, false)).toBe(false);
  });

  it("ignores shift on bare printable keys (layouts where / is shifted)", () => {
    const combo = parseCombo("/");
    expect(matchesCombo(key("/"), combo, false)).toBe(true);
    expect(matchesCombo(key("/", { shiftKey: true }), combo, false)).toBe(true);
    expect(matchesCombo(key("/", { ctrlKey: true }), combo, false)).toBe(false);
  });

  it("matches by produced key value, case-insensitively", () => {
    const combo = parseCombo("mod+k");
    expect(matchesCombo(key("K", { ctrlKey: true, shiftKey: true }), combo, false)).toBe(false);
    expect(matchesCombo(key("K", { ctrlKey: true }), combo, false)).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("flags inputs, textareas, selects, and contenteditable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    div.setAttribute("contenteditable", "true");
    expect(isEditableTarget(div)).toBe(true);
    div.setAttribute("contenteditable", "false");
    expect(isEditableTarget(div)).toBe(false);
    // child of an editable region is editable too (attribute inherits)
    const region = document.createElement("div");
    region.setAttribute("contenteditable", "");
    const child = document.createElement("span");
    region.appendChild(child);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
  });
});

/** Real KeyboardEvent dispatched at a target so e.target is set. */
function fire(target: EventTarget, k: string, mods: Partial<Omit<KeyLike, "key">> = {}) {
  const e = new KeyboardEvent("keydown", {
    key: k,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

describe("registry dispatch", () => {
  it("routes window keydowns to a registered handler and stops after unregister", () => {
    const handler = vi.fn();
    const off = registerHotkey({ combo: "mod+k", description: "test", handler });
    fire(document.body, "k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(activeHotkeys()).toEqual([{ combo: "mod+k", description: "test" }]);
    off();
    fire(document.body, "k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(activeHotkeys()).toEqual([]);
  });

  it("suppresses hotkeys while typing unless allowInInputs", () => {
    const slash = vi.fn();
    const global = vi.fn();
    const off1 = registerHotkey({ combo: "/", description: "open", handler: slash });
    const off2 = registerHotkey({
      combo: "mod+k",
      description: "open (global)",
      allowInInputs: true,
      handler: global,
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fire(input, "/");
    expect(slash).not.toHaveBeenCalled();
    fire(input, "k", { ctrlKey: true });
    expect(global).toHaveBeenCalledTimes(1);
    fire(document.body, "/");
    expect(slash).toHaveBeenCalledTimes(1);
    off1();
    off2();
    input.remove();
  });

  it("gives the event to the most recent matching registration only", () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = registerHotkey({ combo: "escape", description: "outer", handler: first });
    const off2 = registerHotkey({ combo: "escape", description: "inner", handler: second });
    fire(document.body, "Escape");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    off2();
    fire(document.body, "Escape");
    expect(first).toHaveBeenCalledTimes(1);
    off1();
  });

  it("skips disabled registrations and falls through to earlier ones", () => {
    const fallback = vi.fn();
    const disabled = vi.fn();
    const off1 = registerHotkey({ combo: "mod+k", description: "fallback", handler: fallback });
    const off2 = registerHotkey({
      combo: "mod+k",
      description: "disabled",
      enabled: false,
      handler: disabled,
    });
    fire(document.body, "k", { ctrlKey: true });
    expect(disabled).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });

  it("preventDefaults on match by default, opt-out honored", () => {
    const off1 = registerHotkey({ combo: "mod+k", description: "pd", handler: () => {} });
    const e1 = fire(document.body, "k", { ctrlKey: true });
    expect(e1.defaultPrevented).toBe(true);
    off1();
    const off2 = registerHotkey({
      combo: "mod+k",
      description: "no-pd",
      preventDefault: false,
      handler: () => {},
    });
    const e2 = fire(document.body, "k", { ctrlKey: true });
    expect(e2.defaultPrevented).toBe(false);
    off2();
  });

  it("honors an explicit isMac in direct dispatch", () => {
    const handler = vi.fn();
    const off = registerHotkey({ combo: "mod+k", description: "mac", handler });
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    dispatchKeydown(e, true);
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });
});
