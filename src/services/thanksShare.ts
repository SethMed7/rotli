// The thank-you card's effects (2026-09-28): open a link, and Share (the
// owner, 2026-10-15: "a proper Share that opens the native share sheet").
// The words and URLs are lib/thanksBanner.ts; nothing here adds anything
// personal to a link or a share.

import { isTauri, openUrl, shareText } from "../lib/tauri";
import { SHARE_MESSAGE, type ShareOutcome, SITE_URL } from "../lib/thanksBanner";

export function openLink(url: string): Promise<void> {
  return openUrl(url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Share Rotli from a click on `button`. The Mac app opens the macOS share
 * sheet beside it (Messages, Mail, AirDrop, Notes…); Rotli Web uses the
 * browser's own share sheet where there is one. Anywhere a sheet can't open,
 * the line and link go on the clipboard instead, and the outcome says so. */
export async function shareRotli(button: HTMLElement): Promise<ShareOutcome> {
  if (isTauri()) {
    const box = button.getBoundingClientRect();
    try {
      await shareText(SHARE_MESSAGE, SITE_URL, { x: box.x, y: box.y, width: box.width, height: box.height });
      return "sheet";
    } catch {
      // fall through to the clipboard
    }
  } else if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Rotli", text: SHARE_MESSAGE, url: SITE_URL });
      return "sheet";
    } catch (error) {
      // the person closed the sheet: nothing to say
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(`${SHARE_MESSAGE} ${SITE_URL}`)) ? "copied" : "failed";
}
