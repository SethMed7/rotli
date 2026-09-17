// Copying a selection across rendered messages copies their SOURCE Markdown
// (2026-09-16: the browser default serialised the rendered DOM, so a chat
// pasted into another chat or a note lost its formatting).

import type { ClipboardEvent } from "react";

import { visibleChatText } from "../../lib/chatWork";
import { chatSelectionMarkdown, selectedMessageIndices } from "./chatThreadModel";

/** The thread's copy handler: when the selection touches message rows, put
 * their Markdown on the clipboard and take over the event; otherwise leave
 * the browser default alone (a selection inside the composer, for instance). */
export function copyChatSelection(
  event: ClipboardEvent<HTMLElement>,
  messages: readonly { speaker: string; text: string }[],
): void {
  const indices = selectedMessageIndices(event.currentTarget, window.getSelection());
  if (indices.length === 0) return;
  const sources = messages.map((m) => (m.speaker === "you" ? visibleChatText(m.text) : m.text));
  event.clipboardData.setData("text/plain", chatSelectionMarkdown(sources, indices));
  event.preventDefault();
}
