// The file behind a chat row (the owner, 2026-09-17: "I am trying to see the
// source md"): its transcript as written, on both twins. Show in Finder
// already sits further down the menu on the Mac. A seam beside the chat
// sidebar so the menu there stays a list of intents.

import { chatPreviewItem } from "../../services/systemBrowser";
import { useUiStore } from "../../state/ui";

/** The row's summary — the same fields chatPreviewItem reads. */
type ChatRow = Parameters<typeof chatPreviewItem>[0];

export function chatFileMenuItems(c: ChatRow): { kind: "action"; label: string; onClick: () => void }[] {
  return [
    {
      kind: "action",
      label: "Show source",
      onClick: () => useUiStore.getState().setPreviewItem(chatPreviewItem(c)),
    },
  ];
}
