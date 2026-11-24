import { projectChatWorkItems } from "../../lib/chatWork";
import { parseTranscriptTurns } from "../../memex/chatTranscript";
import { type ChatArtifact, parseChatArtifactTurns } from "../../memex/contract";

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

export interface ChatMessage {
  speaker: string;
  text: string;
  at?: string;
  images?: string[];
  artifacts?: ChatArtifact[];
}

/** Parse a chat .md's `## Messages` block back into bubbles. The turn reader
 * (memex/chatTranscript.ts) keeps reply text that looks like a turn inside
 * the reply (chat audit 2026-11-24, D3). */
export function parseChatMessages(body: string, rootPrefix = ""): ChatMessage[] {
  const out: ChatMessage[] = parseTranscriptTurns(body).map(({ speaker, at, text }) => ({
    speaker,
    at,
    text,
  }));
  const artifactTurns = new Map(parseChatArtifactTurns(body).map((turn) => [turn.assistant, turn.artifacts]));
  let assistant = 0;
  for (const message of out) {
    if (message.speaker === "you") continue;
    const artifacts = artifactTurns.get(assistant);
    if (artifacts?.length) message.artifacts = artifacts;
    assistant += 1;
  }
  for (const message of out) {
    if (message.speaker !== "you") continue;
    const attached = projectChatWorkItems({
      rootPrefix,
      messages: [message],
      discoveredIds: [],
    }).filter((item) => item.kind === "image" && item.source === "attachment");
    if (attached.length) message.images = attached.map((item) => item.id);
  }
  return out;
}
