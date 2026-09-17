// The chat surface's side of the drop seam, as one hook: register the pane as
// a drop target for as long as it is mounted. Kept out of chatSurface.tsx so
// the surface stays wiring (it sits at its size ceiling) and so the drop
// behaviors can grow here — a queued attachment for a chat opened by a drop on
// its sidebar row lands in this file next.

import { useEffect, useRef } from "react";

import { registerChatDrop } from "./chatDrop";

export function useChatDropTarget(
  paneId: string,
  attachPaths: (paths: readonly string[]) => void,
  canVision: boolean,
  refuse: () => void,
): void {
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
