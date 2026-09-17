// Chat image plumbing that touches the corpus: resolving an attached image's
// URL. Presentation calls this; the
// Tauri seam stays behind them (check:architecture).

import { fileAssetUrl } from "../lib/tauri";

/** A sent message's image source as something an <img> can load: data, blob,
 * http(s), and asset URLs pass through; a corpus path resolves through the
 * asset protocol. */
export function attachedImageUrl(source: string): Promise<string> {
  return /^(?:https?:|data:|blob:|asset:)/i.test(source) ? Promise.resolve(source) : fileAssetUrl(source);
}
