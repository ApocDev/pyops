import { useEffect } from "react";

/** Keep browser development and the Tauri WebView behavior aligned: PyOps owns
 * right-click interactions, so suppress the platform menu unless a developer
 * explicitly enables it for inspection/debugging. `preventDefault()` does not
 * stop propagation, so component `onContextMenu` handlers still run. */
export function NativeContextMenu() {
  useEffect(() => {
    if (import.meta.env.VITE_PYOPS_NATIVE_CONTEXT_MENU === "true") return;
    const suppress = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  return null;
}
