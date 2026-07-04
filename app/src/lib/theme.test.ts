import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** The theme store drives the `.dark` class + `color-scheme` off a persisted
 * light/dark/system preference (#107). Reset modules between cases so each gets
 * a fresh store initialized from the stubbed localStorage. */
describe("theme store", () => {
  let toggleSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    });
    toggleSpy = vi.fn();
    const root = { classList: { toggle: toggleSpy }, style: { colorScheme: "" } };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("matchMedia", () => ({
      matches: false, // system → light in tests
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("defaults to dark when nothing is stored", async () => {
    const { getTheme, resolvedTheme } = await import("./theme.ts");
    expect(getTheme()).toBe("dark");
    expect(resolvedTheme()).toBe("dark");
  });

  it("setTheme persists, applies the class, and notifies subscribers", async () => {
    const { setTheme, getTheme, subscribeTheme } = await import("./theme.ts");
    const fn = vi.fn();
    subscribeTheme(fn);
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(localStorage.getItem("pyops.theme")).toBe("light");
    expect(toggleSpy).toHaveBeenCalledWith("dark", false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(fn).toHaveBeenCalled();
  });

  it("system resolves via matchMedia (light when the OS is light)", async () => {
    const { setTheme, resolvedTheme } = await import("./theme.ts");
    setTheme("system");
    expect(resolvedTheme()).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("reads a stored preference on init", async () => {
    localStorage.setItem("pyops.theme", "light");
    const { getTheme } = await import("./theme.ts");
    expect(getTheme()).toBe("light");
  });
});
