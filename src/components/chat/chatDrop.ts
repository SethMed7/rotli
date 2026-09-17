// Where a dropped image goes when it lands on a CHAT (the maintainer, 2026-08-04:
// "drag and dropping images into a chat isn't working — they don't attach").
//
// The window's drag-drop listener lives in app.tsx and gets OS PATHS, not a
// DataTransfer. It knew how to find a CodeMirror view under the cursor and
// nothing else, so a drop on a chat fell through to the "import into storage"
// branch: the file landed in the vault and silently never reached the chat.
//
// This is the chat's half of that hit-test — the same shape as the editor's
// registerEditor/activeEditor seam, so the drop handler stays ONE listener that
// asks "who is under the pointer?" rather than growing per-surface knowledge.

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

const targets = new Map<string, AttachImages>();

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
  targets.set(paneId, receive);
  return () => {
    // only clear if still ours — a remount can register the next surface first
    if (targets.get(paneId) === receive) targets.delete(paneId);
  };
}

/** The attribute a chat surface tags itself with so a drop can find its pane. */
export const CHAT_PANE_ATTR = "data-chat-pane";

/** The chat under this point, if any. Returns null when the drop belongs to
 * something else (the editor, the sidebar, empty chrome). */
export function chatDropAt(element: Element | null): AttachImages | null {
  const host = element?.closest(`[${CHAT_PANE_ATTR}]`) as HTMLElement | null;
  const paneId = host?.getAttribute(CHAT_PANE_ATTR);
  if (!paneId) return null;
  return targets.get(paneId) ?? null;
}
