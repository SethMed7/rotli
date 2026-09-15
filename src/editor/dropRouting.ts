// Where external files go — the one policy the Finder drop router and the
// Finder-copy paste lane share. Pure: a fake element stack drives every rule in
// tests, and the effectful delivery lives in fileDelivery.ts.
//
// The router used to ask `elementFromPoint` for the single TOPMOST element. Any
// full-window overlay (the old guided-tour scrims, a transient layer) then
// "owned" the drop, no chat or editor was found, and the file silently landed
// in storage/ with nothing on screen. Now the whole stack under the point is
// walked, past chrome that is not a drop target, and stops only at a modal:
// a drop on a dialog never tunnels into the note hidden beneath it.

import { isChatImagePath } from "../components/chat/chatDrop";
import { type DropPoint, isEmbeddablePath } from "./externalImageDrop";

/** What owns a drop outright: dialogs and their backdrops. The tour card is
 * NOT here — the tour is a non-modal overlay the app stays live under. */
const DROP_BLOCKERS = '[aria-modal="true"], [role="dialog"], .pv-scrim, .pal-focus-scrim';

interface Closest {
  closest(selector: string): unknown;
}

/** The elements a drop at one point may reach, top-down, ending before the
 * first modal layer. */
function reachable<E extends Closest>(stack: readonly E[]): E[] {
  const out: E[] = [];
  for (const element of stack) {
    if (element.closest(DROP_BLOCKERS)) break;
    out.push(element);
  }
  return out;
}

export interface DropCandidate<E> {
  point: DropPoint;
  /** `document.elementsFromPoint(point)` — topmost first. */
  stack: readonly E[];
}

/** The first reachable element any candidate point resolves to a target, in
 * candidate order (Tauri's physical→CSS pair first, then the raw pair). */
export function firstTarget<E extends Closest, T>(
  candidates: readonly DropCandidate<E>[],
  resolve: (element: E) => T | null,
): { target: T; point: DropPoint } | null {
  for (const { point, stack } of candidates) {
    for (const element of reachable(stack)) {
      const target = resolve(element);
      if (target) return { target, point };
    }
  }
  return null;
}

export type DropSurface = "chat" | "editor" | "none";

/** A file paste the host granted nothing for. If the pasteboard no longer holds
 * file references, the focus-time check was stale (Rotli itself copied text
 * since, e.g. "Copy path"). The note gets the text back, and a chat asks for a
 * retry, which now pastes normally. Otherwise the grant for this copy is spent:
 * copy again in Finder. */
export function emptyPasteOutcome(
  stillHasFiles: boolean,
  surface: "chat" | "editor",
  text: string,
): "insert-text" | "paste-again" | "copy-again" {
  if (stillHasFiles) return "copy-again";
  return surface === "editor" && text ? "insert-text" : "paste-again";
}

/** What a DOM paste event exposes, read synchronously. */
export interface PastePayload {
  types: readonly string[];
  fileCount: number;
  uriList: string;
}

/** How to take a paste as files: `paths` asks the host for the copied Finder
 * files (granted like a drop); `bytes` falls back to pasted image data. */
export interface PasteFiles {
  paths: boolean;
  bytes: boolean;
}

/** Decide AT PASTE TIME (the default can only be cancelled synchronously)
 * whether a paste is a file paste. WKWebView gives a Finder copy to the page
 * as just its file NAME in text/plain, so the host's pasteboard type check
 * (`pasteboardHasFiles`, refreshed when the window gains focus) is the
 * reliable signal; a `file://` uri-list is the portable one. Pasted image
 * bytes count only in a note — a chat attaches paths — and only when no text
 * rides along, so a rich copy from a web page keeps pasting as text. `null`
 * lets the ordinary paste run. */
export function classifyPaste(
  payload: PastePayload,
  surface: "chat" | "editor",
  pasteboardHasFiles: boolean,
): PasteFiles | null {
  const paths = pasteboardHasFiles || /^file:\/\//im.test(payload.uriList);
  const textual = payload.types.includes("text/plain") || payload.types.includes("text/html");
  const bytes = surface === "editor" && payload.fileCount > 0 && !textual;
  return paths || bytes ? { paths, bytes } : null;
}

export interface DropPlan {
  /** Images the chat attaches (its own, narrower predicate). */
  attach: string[];
  /** Images and videos the note embeds at the drop point. */
  embed: string[];
  /** Everything else, copied into storage/ (Assets). */
  store: string[];
  /** A visible line when files went to Assets with nothing inserted. */
  notice: string | null;
}

export const UNROUTED_MEDIA_NOTICE = "Saved to Assets — drop onto a note or chat to insert";

/** Partition external files for the surface that received them. A chat asks
 * the chat what it accepts (an .svg routed by the editor's wider rule was
 * refused there and never stored); a note embeds; nothing else is silent. */
export function planDrop(paths: readonly string[], surface: DropSurface): DropPlan {
  if (surface === "chat") {
    return {
      attach: paths.filter(isChatImagePath),
      embed: [],
      store: paths.filter((path) => !isChatImagePath(path)),
      notice: null,
    };
  }
  if (surface === "editor") {
    return {
      attach: [],
      embed: paths.filter(isEmbeddablePath),
      store: paths.filter((path) => !isEmbeddablePath(path)),
      notice: null,
    };
  }
  const media = paths.some(isEmbeddablePath);
  const count = paths.length === 1 ? "1 file" : `${paths.length} files`;
  return {
    attach: [],
    embed: [],
    store: [...paths],
    notice: paths.length === 0 ? null : media ? UNROUTED_MEDIA_NOTICE : `Saved ${count} to Assets`,
  };
}
