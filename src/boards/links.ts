// Where a link on a board shape goes (2026-10-08). Excalidraw's own fallback is
// window.open, which the Mac app's webview ignores — every board link was a
// dead click. The surfaces hand the link to this classifier and open the
// answer themselves: a web address through the scheme-allowlisted opener, a
// `[[note]]` as a tab, a link to another shape by scrolling the canvas to it.
// Pure: no vendor API, no DOM.

import { wikilinkTargetOf } from "../editor/wikilink";

export type BoardLink =
  /** A link to another shape (Excalidraw's "Link to element"). `web` is the
   * address to open instead when the shape isn't on this board and the link
   * is a real web page that merely carries an `?element=` parameter. */
  | { kind: "element"; id: string; web: string | null }
  | { kind: "web"; url: string }
  | { kind: "note"; target: string }
  | { kind: "unsupported"; link: string };

const WEB_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const WIKILINK = /^\[\[([^\]]+)\]\]$/;

/** The `?element=` id Excalidraw writes into a shape-to-shape link. Read from
 * any origin: a board linked in Rotli Web carries the web address, and the
 * same file opened in the Mac app must still jump to the shape. */
export function boardElementLinkId(link: string): string | null {
  try {
    return new URL(link, "https://board.invalid/").searchParams.get("element") || null;
  } catch {
    return null;
  }
}

export function classifyBoardLink(raw: string): BoardLink {
  const link = raw.trim();
  const wiki = WIKILINK.exec(link);
  if (wiki) {
    const target = wikilinkTargetOf(wiki[1] ?? "");
    return target ? { kind: "note", target } : { kind: "unsupported", link };
  }
  const web = isWebAddress(link) ? link : null;
  const id = boardElementLinkId(link);
  if (id) return { kind: "element", id, web };
  return web ? { kind: "web", url: web } : { kind: "unsupported", link };
}

function isWebAddress(link: string): boolean {
  try {
    return WEB_SCHEMES.has(new URL(link).protocol);
  } catch {
    return false;
  }
}
