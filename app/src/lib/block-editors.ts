/**
 * Open-block-editor registry (#90). The block editor registers itself here for
 * the block it has open; external writers (undo today; snapshot restore #85 and
 * assistant applies #12 next) look the editor up by block id and push the fresh
 * server doc into it via `hydrate` instead of letting the editor's in-memory
 * state — and its next auto-save — silently clobber the external change.
 *
 * Module-level (like the hotkey registry) so the undo runner doesn't need
 * React context threading: the editor mounts/unmounts its entry, anything can
 * consult it.
 */
import type { RawBlockData } from "./goals";

export type OpenBlockEditor = {
  /** Replace the editor's doc with fresh server state (clean — must not
   * trigger an auto-save). `updatedAt` (epoch seconds) becomes the editor's
   * new save-conflict baseline. */
  hydrate: (doc: RawBlockData, name: string, updatedAt: number | null) => void;
  /** The block no longer exists (an undo reverted its creation) — the editor
   * should leave rather than auto-save it back into existence. */
  onDeleted: () => void;
};

const editors = new Map<number, OpenBlockEditor>();

/** Register the open editor for `blockId`; returns the unregister function.
 * One editor per block id — a remount simply replaces the entry. */
export function registerBlockEditor(blockId: number, editor: OpenBlockEditor): () => void {
  editors.set(blockId, editor);
  return () => {
    if (editors.get(blockId) === editor) editors.delete(blockId);
  };
}

/** The open editor for a block, if one is mounted. */
export function openBlockEditor(blockId: number): OpenBlockEditor | undefined {
  return editors.get(blockId);
}
