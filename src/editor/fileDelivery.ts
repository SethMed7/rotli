// Delivering granted external files to what received them — shared by the
// Finder drop router (nativeFileDrop.ts) and the Finder-copy paste lane
// (nativeFilePaste.ts), so a paste lands exactly where a drop would. The
// partition policy is pure in dropRouting.ts.

import type { EditorView } from "@codemirror/view";

import { corpusImportFile, rootIdOf } from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { showFileNotice } from "../state/fileNotice";
import { planDrop } from "./dropRouting";
import { importImagePathsAtPosition } from "./externalImageDrop";
import { noteIdFacet } from "./livePreview";

export type FileTarget =
  | { kind: "chat"; attach: (paths: readonly string[]) => void }
  /** `at` is resolved BEFORE any file I/O: layout may move while importing. */
  | { kind: "editor"; view: EditorView; at: number }
  | { kind: "none" };

/** Import granted OS paths into `target`: a chat attaches its images, a note
 * embeds at `at` into its own root, the rest goes to Assets — visibly. */
export async function deliverFiles(paths: readonly string[], target: FileTarget): Promise<void> {
  const plan = planDrop(paths, target.kind);
  const rootId = target.kind === "editor" ? rootIdOf(target.view.state.facet(noteIdFacet)) : "default";
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
