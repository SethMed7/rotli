import { PLATFORM } from "../lib/featurePolicy";
import { corpusCreateImageAsset, corpusImportFile, corpusPickImages, rootIdOf } from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { pickBrowserImages } from "./browserImagePicker";
import {
  type ImageDropEditor,
  importImageFilesAtPosition,
  importImagePathsAtPosition,
  isEmbeddablePath,
  isImagePath,
} from "./externalImageDrop";

/** Picker effects and asset import share paste/drop's byte and insertion lane.
 * Capture the slash position before either the OS or browser picker opens. */
export async function attachImagesAtPosition(
  view: ImageDropEditor,
  noteId: string,
  at: number,
): Promise<void> {
  const rootId = rootIdOf(noteId);
  if (PLATFORM === "web") {
    const files = (await pickBrowserImages()).filter((file) => isImagePath(file.name));
    if (files.length === 0) {
      view.focus();
      return;
    }
    await importImageFilesAtPosition(view, files, at, (name, base64) =>
      corpusCreateImageAsset(rootId, name, base64),
    );
  } else {
    const paths = (await corpusPickImages()).filter(isEmbeddablePath);
    if (paths.length === 0) {
      view.focus();
      return;
    }
    await importImagePathsAtPosition(view, paths, at, (path) => corpusImportFile(rootId, path));
  }
  await invalidateNotes();
}
