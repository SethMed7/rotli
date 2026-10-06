// A sent message names its attachments as `[Image #n]` (chatWork.ts owns the
// durable token; visibleChatText strips the storage target). In the bubble
// that token reads as a chip carrying the same `#n` the composer showed on the
// thumbnail (the owner, 2026-09-17: "have like a {#1} for the images this way
// I can visually see where I added the images"); since 2026-10-05 the chip also
// shows the image, its name, and its size. The token format itself is untouched.

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { fileName } from "../../lib/fileKind";
import { formatBytes } from "../../lib/formatBytes";
import { attachedImageSize, attachedImageUrl } from "../../services/chatImages";

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

/** What a chip calls an image: its vault file name, or "Image n" for one
 * that only exists as data (an image sent before it had a vault id). */
export function imageChipName(source: string | undefined, index: number): string {
  if (!source || /^(?:data|blob):/i.test(source)) return `Image ${index}`;
  return fileName(source);
}

/** The tag where the image was referenced (the owner, 2026-10-05, after a
 * modern composer): a small thumbnail, the file name, and its size. */
function ImageRefChip({ index, source }: { index: number; source: string | undefined }) {
  const url = useQuery({
    queryKey: ["chat-attached-image", source ?? ""],
    queryFn: () => attachedImageUrl(source ?? ""),
    enabled: !!source,
    staleTime: Infinity,
  }).data;
  const size = useQuery({
    queryKey: ["chat-attached-image-size", source ?? ""],
    queryFn: () => attachedImageSize(source ?? ""),
    enabled: !!source,
    staleTime: Infinity,
  }).data;
  const name = imageChipName(source, index);
  const label = size ? `Image ${index}: ${name}, ${formatBytes(size)}` : `Image ${index}: ${name}`;
  return (
    <span className="cmsg-imgref" aria-label={label} title={label}>
      {url ? <img src={url} alt="" /> : <span className="cmsg-imgref-n">{`#${index}`}</span>}
      <span className="cmsg-imgref-name">{name}</span>
      {size ? <span className="cmsg-imgref-size">{formatBytes(size)}</span> : null}
    </span>
  );
}

/** The user's message with each `[Image #n]` drawn as a chip for that image. */
export function UserMessageText({
  text,
  images = [],
}: {
  text: string;
  images?: readonly string[];
}): ReactNode {
  const parts = splitImageRefs(text);
  if (parts.every((part) => part.kind === "text")) return text;
  return parts.map((part, i) =>
    part.kind === "text" ? (
      part.value
    ) : (
      <ImageRefChip key={i} index={part.index} source={images[part.index - 1]} />
    ),
  );
}
