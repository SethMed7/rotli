// Chat image plumbing that touches the corpus: resolving an attached image's
// URL and keeping refused drops in Assets. Presentation calls these; the
// Tauri seam stays behind them (check:architecture).

import { corpusImportFile, fileAssetUrl } from "../lib/tauri";
import { showFileNotice } from "../state/fileNotice";
import { invalidateNotes } from "./hooks";

/** A sent message's image source as something an <img> can load: data, blob,
 * http(s), and asset URLs pass through; a corpus path resolves through the
 * asset protocol. */
export function attachedImageUrl(source: string): Promise<string> {
  return /^(?:https?:|data:|blob:|asset:)/i.test(source) ? Promise.resolve(source) : fileAssetUrl(source);
}

/** A chat whose model cannot see refuses the attachment, but the dropped
 * files are the user's: keep them in Assets and say so (2026-09-16 — they
 * were discarded with only the vision hint). */
export async function stashRefusedChatDrop(rootId: string, paths: readonly string[]): Promise<void> {
  await Promise.allSettled(paths.map((path) => corpusImportFile(rootId, path)));
  await invalidateNotes();
  showFileNotice("Saved to Assets — this model can't see images, so nothing was attached");
}
