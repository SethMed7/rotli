// The thank-you card's effects (2026-09-28): open a link, save the banner,
// put the banner or an invite on the clipboard. The words and URLs are
// lib/thanksBanner.ts; nothing here adds anything personal to a link.

import { corpusCreateImageAsset, isTauri, openUrl } from "../lib/tauri";
import { BANNER_FILE_NAME } from "../lib/thanksBanner";

export function openLink(url: string): Promise<void> {
  return openUrl(url);
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Whether "keep the banner" means the vault's Assets (the Mac app). */
export function bannerSavesToAssets(): boolean {
  return isTauri();
}

/** The Mac app saves into the vault's Assets (a webview has no Downloads);
 * a browser downloads the file. */
export async function saveBanner(blob: Blob): Promise<"assets" | "download"> {
  if (bannerSavesToAssets()) {
    await corpusCreateImageAsset("default", BANNER_FILE_NAME, await base64Of(blob));
    return "assets";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = BANNER_FILE_NAME;
  // attached and kept a while, as downloadVaultZip does: some browsers read
  // the URL after the click returns
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "download";
}

/** Call from the click itself: the clipboard needs the user's gesture. */
export async function copyBannerImage(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
