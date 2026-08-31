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
