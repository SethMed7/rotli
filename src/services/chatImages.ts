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

/** A chat artifact's thumbnail: always a vault file through the asset
 * protocol (Rust checks the path stays in the vault). An artifact id is never
 * a web address, so none passes through untouched the way a sent image may. */
export function artifactThumbUrl(id: string): Promise<string> {
  return fileAssetUrl(id);
}

/** An image or video a reply links from the chat's vault (`storage:` path),
 * as a URL: the asset protocol on the Mac; on Rotli Web the connected
 * folder's image (a video there resolves to "" and shows its name). */
export function replyMediaUrl(rootPrefix: string, path: string): Promise<string> {
  return resolveImageSrc(`storage:${path}`, replyMediaRootId(rootPrefix));
}

/** A chat's wire-id prefix ("<root>:", or "" for the default vault) as a root id. */
export function replyMediaRootId(rootPrefix: string): string {
  return rootPrefix.endsWith(":") ? rootPrefix.slice(0, -1) : rootPrefix || "default";
}
