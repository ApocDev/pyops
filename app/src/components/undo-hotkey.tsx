import { useQueryClient } from "@tanstack/react-query";

import { useHotkey } from "../lib/hotkeys";
import { runUndo } from "../lib/undo-client";

/** App-global Ctrl+Z / Cmd+Z (#90), mounted once in the root shell. Deliberately
 * NOT `allowInInputs`: while focus is in a text field, Ctrl+Z stays the field's
 * native text undo — the app-level undo only fires from the page. Renders
 * nothing; the visible affordance is `UndoButton` in the nav. */
export function UndoHotkey() {
  const qc = useQueryClient();
  useHotkey("mod+z", () => void runUndo(qc), { description: "Undo the last action" });
  return null;
}
