// Chat image plumbing that touches the corpus: resolving an attached image's
// URL. Presentation calls this; the
// Tauri seam stays behind them (check:architecture).

import { corpusFileStat, fileAssetUrl, resolveImageSrc, splitRootId } from "../lib/tauri";

const PASS_THROUGH = /^(?:https?:|data:|blob:|asset:)/i;

/** A sent message's image source as something an <img> can load: data, blob,
 * http(s), and asset URLs pass through; a vault id resolves in its own vault —
 * the asset protocol on the Mac, the connected folder on Rotli Web (where a
 * reloaded chat's images used to come back blank, 2026-10-05). */
export function attachedImageUrl(source: string): Promise<string> {
  if (PASS_THROUGH.test(source)) return Promise.resolve(source);
  const { rootId, rel } = splitRootId(source);
  return resolveImageSrc(rel, rootId);
}

/** An attached image's size in bytes for its chip: a data URL measures its
 * payload; a vault id asks the vault (the Mac app). Null when nobody can say —
 * the chip then shows no size rather than a guess. */
export async function attachedImageSize(source: string): Promise<number | null> {
  const data = /^data:[^,]*;base64,(.*)$/i.exec(source);
  if (data) {
    const payload = data[1] ?? "";
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.floor((payload.length * 3) / 4) - padding;
  }
  if (PASS_THROUGH.test(source)) return null;
  const stat = await corpusFileStat(source).catch(() => null);
  return stat ? stat.len : null;
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
