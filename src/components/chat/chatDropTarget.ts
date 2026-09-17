// The chat surface's side of the drop seam, as one hook: register the pane as
// a drop target for as long as it is mounted, and take the images a drop on
// this chat's SIDEBAR ROW queued while the composer was still mounting
// (chatDropQueue.ts). Kept out of chatSurface.tsx so the surface stays wiring
// (it sits at its size ceiling).

import { useEffect, useRef } from "react";

import { registerChatDrop } from "./chatDrop";
import { onChatAttachment, takeChatAttachment } from "./chatDropQueue";

export function useChatDropTarget(
  paneId: string,
  chatSlug: string | null | undefined,
  attachPaths: (paths: readonly string[]) => void,
  canVision: boolean,
  refuse: () => void,
  ready: boolean,
): void {
  // A row drop attaches regardless of the model's vision: the composer may
  // mount before the model catalog has settled, and the send path already
  // refuses images for a model that cannot see, in words, at send time.
  // `ready` is whether attachPaths can import at all (the vault is known):
  // taking the paths before that would lose them. Drained on mount and
  // whenever a drop queues more — the chat may already be open.
  useEffect(() => {
    if (!chatSlug || !ready) return;
    const drain = () => {
      const queued = takeChatAttachment(chatSlug);
      if (queued) attachPaths(queued);
    };
    drain();
    return onChatAttachment(chatSlug, drain);
  }, [chatSlug, attachPaths, ready]);
  // the refusal is an inline closure at the call site; read it through a ref
  // (updated after render, the React Compiler's rule) so a re-render never
  // re-registers the pane
  const refuseRef = useRef(refuse);
  useEffect(() => {
    refuseRef.current = refuse;
  });
  // The current model gates the drop before any image is imported.
  useEffect(
    () => registerChatDrop(paneId, attachPaths, canVision, () => refuseRef.current()),
    [paneId, attachPaths, canVision],
  );
}
