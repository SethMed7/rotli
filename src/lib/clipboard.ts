// The pasteboard beyond what a copy event can carry. A copy that spans an
// image resolves the bytes AFTER the event has fired, so the finished HTML
// (with `data:` images) is written through the host's clipboard plugin.
import { invoke } from "@tauri-apps/api/core";
import { writeHtml } from "@tauri-apps/plugin-clipboard-manager";

import { isTauri } from "./tauri";

/** Replace the pasteboard with HTML plus its plain-text reading. */
export async function writeClipboardHtml(html: string, text: string): Promise<void> {
  if (!isTauri()) return;
  await writeHtml(html, text);
}

/** A corpus image (`storage:` or corpus-relative) as a `data:` URL, or "" when
 * it cannot be inlined (too large, not an image, outside Tauri). */
export async function corpusImageDataUrl(rootId: string, src: string): Promise<string> {
  if (!isTauri()) return "";
  const rel = src.startsWith("storage:") ? `storage/${src.slice("storage:".length)}` : src;
  try {
    return await invoke<string>("corpus_image_data_url", { rootId, rel });
  } catch {
    return "";
  }
}
