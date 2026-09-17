// A sent message names its attachments as `[Image #n]` (chatWork.ts owns the
// durable token; visibleChatText strips the storage target). In the bubble
// that token reads as a chip carrying the same `#n` the composer showed on the
// thumbnail (the owner, 2026-09-17: "have like a {#1} for the images this way
// I can visually see where I added the images"). Pure splitter + one small
// renderer; the token format itself is untouched.

import type { ReactNode } from "react";

/** `[Image #3]`, case-insensitive, as visibleChatText leaves it. */
const IMAGE_REF = /\[Image #(\d+)\]/gi;

export type MessagePart = { kind: "text"; value: string } | { kind: "ref"; index: number };

/** Split a user message into prose and image references, in order. Text
 * between references keeps its whitespace; an empty text run is dropped. */
export function splitImageRefs(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(IMAGE_REF)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "ref", index: Number(match[1]) });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

/** The user's message with each `[Image #n]` drawn as a `#n` chip. */
export function UserMessageText({ text }: { text: string }): ReactNode {
  const parts = splitImageRefs(text);
  if (parts.every((part) => part.kind === "text")) return text;
  return parts.map((part, i) =>
    part.kind === "text" ? (
      part.value
    ) : (
      <span key={i} className="cmsg-imgref" aria-label={`Image ${part.index}`} title={`Image ${part.index}`}>
        {`#${part.index}`}
      </span>
    ),
  );
}
