/**
 * The Markdown chat file remains complete durable truth. The interactive
 * surface keeps only a recent window mounted so a years-long thread cannot
 * turn React/WebKit into an unbounded transcript cache.
 */
export const CHAT_MESSAGE_WINDOW = 500;

export interface ChatThreadWindow<T> {
  messages: T[];
  hiddenCount: number;
}

export function recentChatThread<T>(messages: readonly T[]): ChatThreadWindow<T> {
  const hiddenCount = Math.max(0, messages.length - CHAT_MESSAGE_WINDOW);
  return {
    messages: hiddenCount === 0 ? [...messages] : messages.slice(hiddenCount),
    hiddenCount,
  };
}

/** The message rows a DOM selection touches, by their `data-chat-message-index`,
 * in thread order. Empty for a collapsed selection or one outside the thread. */
export function selectedMessageIndices(thread: Element, selection: Selection | null): number[] {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  const indices: number[] = [];
  for (const row of thread.querySelectorAll<HTMLElement>("[data-chat-message-index]")) {
    if (!range.intersectsNode(row)) continue;
    const index = Number(row.dataset.chatMessageIndex);
    if (Number.isFinite(index)) indices.push(index);
  }
  return indices;
}

/** The source Markdown of the selected messages, oldest first, one blank
 * line between turns — what a paste into another chat (or a note) needs to
 * render exactly as the thread did. Pure; exported for tests. */
export function chatSelectionMarkdown(sources: readonly string[], indices: readonly number[]): string {
  return [...new Set(indices)]
    .sort((a, b) => a - b)
    .map((index) => sources[index]?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}
