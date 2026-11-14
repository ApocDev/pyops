declare global {
  interface Window {
    /** render tally by key, dev builds only (see `countRender`) */
    __pyopsRenders?: Record<string, number>;
  }
}

/** Dev-only render tally for the block editor's perf guard (#154). Memoized
 * editor pieces (goal tiles, recipe rows, balance chips) call this from their
 * render with a key like `goal:<name>`. The large-block e2e resets
 * `window.__pyopsRenders`, makes an edit, and checks that only the pieces the
 * edit touched rendered. Production builds drop the body. */
export function countRender(key: string) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const tally = (window.__pyopsRenders ??= {});
  tally[key] = (tally[key] ?? 0) + 1;
}
