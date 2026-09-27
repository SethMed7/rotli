// Chat image plumbing that touches the corpus: resolving an attached image's
// URL. Presentation calls this; the
// Tauri seam stays behind them (check:architecture).

import { fileAssetUrl, resolveImageSrc } from "../lib/tauri";

/** A sent message's image source as something an <img> can load: data, blob,
 * http(s), and asset URLs pass through; a corpus path resolves through the
 * asset protocol. */
export function attachedImageUrl(source: string): Promise<string> {
  return /^(?:https?:|data:|blob:|asset:)/i.test(source) ? Promise.resolve(source) : fileAssetUrl(source);
}

/** An image or video a reply links from the chat's vault (`storage:` path),
 * as a URL: the asset protocol on the Mac; on Rotli Web the connected
 * folder's image (a video there resolves to "" and shows its name). */
export function replyMediaUrl(rootPrefix: string, path: string): Promise<string> {
  return resolveImageSrc(`storage:${path}`, rootPrefix ? rootPrefix.slice(0, -1) : "default");
}
