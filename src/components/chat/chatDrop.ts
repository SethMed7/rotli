// Where a dropped image goes when it lands on a CHAT (the maintainer, 2026-08-04:
// "drag and dropping images into a chat isn't working — they don't attach").
//
// The window's drag-drop listener lives in nativeFileDrop.ts and gets OS PATHS,
// not a DataTransfer. It knew how to find a CodeMirror view under the cursor and
// nothing else, so a drop on a chat fell through to the "import into storage"
// branch: the file landed in the vault and silently never reached the chat.
//
// This is the chat's half of that hit-test — the same shape as the editor's
// registerEditor/activeEditor seam, so the drop handler stays ONE listener that
// asks "who is under the pointer?" rather than growing per-surface knowledge.
// The same registry answers the HOVER (2026-09-17, the owner: "a visual cue
// when I am hovering an image over that it is working prior to dropping"):
// the pane under the pointer is stamped with what a drop there would do, and
// memex.css turns that into a ring and a label.

import { CHAT_IMAGE_ASSET_EXTS } from "../../lib/chatWork";
import { extOf } from "../../lib/fileKind";

type AttachImages = (paths: readonly string[]) => void;

/** Whether a dropped OS path is an image the chat asset lane accepts. The
 * window router partitions with THIS predicate, not the editor's wider one:
 * an `.svg` routed here by the editor's rule was refused by the chat AND never
 * reached storage — the user's file simply vanished. */
export function isChatImagePath(path: string): boolean {
  return CHAT_IMAGE_ASSET_EXTS.includes(extOf(path));
}

interface ChatDropEntry {
  receive: AttachImages;
  canVision: boolean;
}

const targets = new Map<string, ChatDropEntry>();

/** A mounted chat composer offers itself as a drop target for its pane. */
export function registerChatDrop(
  paneId: string,
  attach: AttachImages,
  canVision: boolean,
  refuse: () => void,
): () => void {
  // Refuse before the attachment callback can import anything into Assets.
  const receive: AttachImages = (paths) => {
    if (canVision) attach(paths);
    else refuse();
  };
  const entry = { receive, canVision };
  targets.set(paneId, entry);
  return () => {
    // only clear if still ours — a remount can register the next surface first
    if (targets.get(paneId) === entry) targets.delete(paneId);
  };
}

/** The attribute a chat surface tags itself with so a drop can find its pane. */
export const CHAT_PANE_ATTR = "data-chat-pane";

/** The element-ish shape the hit-tests need — a DOM Element in the app, a
 * stub in tests. */
interface HostLike {
  closest(selector: string): HostLike | null;
  getAttribute(name: string): string | null;
}

function paneHost(element: HostLike | null): { host: HostLike; paneId: string } | null {
  const host = element?.closest(`[${CHAT_PANE_ATTR}]`) ?? null;
  const paneId = host?.getAttribute(CHAT_PANE_ATTR);
  return host && paneId ? { host, paneId } : null;
}

/** The chat under this point, if any. Returns null when the drop belongs to
 * something else (the editor, the sidebar, empty chrome). */
export function chatDropAt(element: Element | null): AttachImages | null {
  const found = paneHost(element);
  return found ? (targets.get(found.paneId)?.receive ?? null) : null;
}

/** What hovering an image over this chat would do on drop. */
export type ChatDropCue = "attach" | "blind" | "web";

export interface ChatDropTarget {
  host: Element;
  cue: ChatDropCue;
}

/** The chat pane under this point and the cue it should show while an image
 * hovers: `attach` when its model can see, `blind` when it cannot (the drop
 * will refuse). A pane with no registered composer is not a target. */
export function chatDropTargetAt(element: Element | null): ChatDropTarget | null {
  const found = paneHost(element);
  if (!found) return null;
  const entry = targets.get(found.paneId);
  if (!entry) return null;
  return { host: found.host as unknown as Element, cue: entry.canVision ? "attach" : "blind" };
}

/** The attribute a hovered drop target carries; the stylesheets draw the cue
 * from it — a chat pane (memex.css) or a sidebar row (notes.css). */
export const DROP_OVER_ATTR = "data-drop-over";

interface CueHost {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** One target shows a cue at a time. Idempotent: the same host and cue write
 * nothing, so a hover that fires every few milliseconds never thrashes the
 * DOM; a different host clears the previous one first. */
export class DropCueMarker {
  private host: CueHost | null = null;

  show(host: CueHost, cue: string): void {
    if (this.host && this.host !== host) this.clear();
    if (host.getAttribute(DROP_OVER_ATTR) !== cue) host.setAttribute(DROP_OVER_ATTR, cue);
    this.host = host;
  }

  clear(): void {
    this.host?.removeAttribute(DROP_OVER_ATTR);
    this.host = null;
  }

  /** The host currently marked, if any. */
  get current(): CueHost | null {
    return this.host;
  }
}
