// Delivering granted external files to what received them — shared by the
// Finder drop router (nativeFileDrop.ts) and the Finder-copy paste lane
// (nativeFilePaste.ts), so a paste lands exactly where a drop would. The
// partition policy is pure in dropRouting.ts.

import type { EditorView } from "@codemirror/view";

import { corpusImportBoard, corpusImportFile, rootIdOf } from "../lib/tauri";
import { registerPopulatedManagedItem } from "../newItems/composition";
import { invalidateNotes } from "../services/hooks";
import { showFileNotice } from "../state/fileNotice";
import { usePanesStore } from "../state/panes";
import { planDrop } from "./dropRouting";
import { importImagePathsAtPosition } from "./externalImageDrop";
import { noteIdFacet } from "./livePreview";

export type FileTarget =
  | { kind: "chat"; attach: (paths: readonly string[]) => void }
  /** `at` is resolved BEFORE any file I/O: layout may move while importing. */
  | { kind: "editor"; view: EditorView; at: number }
  | { kind: "board" }
  | { kind: "none" };

/** An Excalidraw board, wherever it was dropped. */
export const isBoardPath = (path: string): boolean => /\.excalidraw$/i.test(path);

/** A dropped board becomes an editable board (owner, 2026-10-13: "users should
 * be able to just drop in excalidraw boards and they work"): copied into the
 * vault's board home, filed in Main like any new board, and opened in a tab. */
async function openDroppedBoard(rootId: string, path: string): Promise<void> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    const board = await corpusImportBoard(rootId, path);
    await registerPopulatedManagedItem({ id: board.id, kind: "board" });
    usePanesStore.getState().openCanvas(board.id, { newTab: true });
  } catch (error) {
    showFileNotice(
      `Couldn’t open ${name} as a board — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Import granted OS paths into `target`: a dropped board opens as a board, a
 * chat attaches its images, a note embeds at `at` into its own root, the rest
 * goes to Assets — visibly. */
export async function deliverFiles(dropped: readonly string[], target: FileTarget): Promise<void> {
  const rootId = target.kind === "editor" ? rootIdOf(target.view.state.facet(noteIdFacet)) : "default";
  for (const path of dropped.filter(isBoardPath)) await openDroppedBoard(rootId, path);
  const paths = dropped.filter((path) => !isBoardPath(path));
  const plan = planDrop(paths, target.kind);
  if (target.kind === "chat" && plan.attach.length > 0) target.attach(plan.attach);
  if (plan.store.length > 0) await Promise.all(plan.store.map((path) => corpusImportFile(rootId, path)));
  if (target.kind === "editor" && plan.embed.length > 0) {
    await importImagePathsAtPosition(target.view, plan.embed, target.at, (path) =>
      corpusImportFile(rootId, path),
    );
  }
  if (plan.notice) showFileNotice(plan.notice);
  await invalidateNotes();
}
