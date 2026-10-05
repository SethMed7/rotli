// Where an attached image is referenced in the message (the owner, 2026-10-05:
// a tag "in the message text where it was referenced", like a modern composer).
// Attaching types `[Image #n]` at the caret; removing a thumbnail removes its
// tag and renumbers the rest; sending turns each tag into the durable link
// chatWork.ts owns. Pure text in, text out — the composer stays a textarea.

import { attachmentReference } from "../../lib/chatWork";
import { type ChatImageAttachment, chatDraftFor, useChatDrafts } from "../../state/chatDrafts";

/** A tag the composer typed: `[Image #3]`, not already a link. */
const BARE_TAG = /\[Image #(\d+)\](?!\()/gi;

export function imageTag(index: number): string {
  return `[Image #${index}]`;
}

/** Type tags for images `first`… at the caret, spaced from the words around
 * them. Returns the new text and the caret just after the last tag. */
export function insertImageTags(
  text: string,
  caret: number,
  first: number,
  count: number,
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const tags = Array.from({ length: count }, (_, i) => imageTag(first + i)).join(" ");
  const lead = before === "" || /\s$/.test(before) ? "" : " ";
  const trail = after === "" || /^\s/.test(after) ? "" : " ";
  const inserted = `${lead}${tags}${trail}`;
  return { text: before + inserted + after, caret: before.length + lead.length + tags.length };
}

/** Drop image `removed`'s tag (and one space it leaves doubled) and number the
 * later images down by one, so every tag still names its thumbnail. */
export function removeImageTag(text: string, removed: number): string {
  const without = text
    .replace(new RegExp(`^\\[Image #${removed}\\](?!\\() ?`, "i"), "")
    .replace(new RegExp(` ?\\[Image #${removed}\\](?!\\()`, "gi"), "");
  return without.replace(BARE_TAG, (tag, n: string) => {
    const index = Number(n);
    return index > removed ? imageTag(index - 1) : tag;
  });
}

/** The message as sent: each tag for an attached image becomes its durable
 * link where it was typed; images nobody tagged lead the message, as before. */
export function composeImageText(typed: string, images: readonly { id: string }[]): string {
  if (images.length === 0) return typed;
  const tagged = new Set<number>();
  const linked = typed.replace(BARE_TAG, (tag, n: string) => {
    const index = Number(n);
    const image = images[index - 1];
    if (!image) return tag;
    tagged.add(index);
    return image.id ? attachmentReference(index, image.id) : imageTag(index);
  });
  const lead = images
    .map((image, i) => ({ image, index: i + 1 }))
    .filter(({ index }) => !tagged.has(index))
    .map(({ image, index }) => (image.id ? attachmentReference(index, image.id) : imageTag(index)))
    .join(" ");
  if (lead === "") return linked;
  return linked ? `${lead}\n${linked}` : lead;
}

/** What Rotli Web says when an image is offered to a chat: Rotli Helper
 * carries text only, by design (helper.rs refuses image turns). */
export const WEB_IMAGES_NEED_THE_MAC_APP =
  "Sending images in a chat needs the Mac app — Rotli Helper carries text only. Drop the image into a note instead.";

/** The images a paste offers a chat: image files with no text riding along
 * (a rich copy from a web page keeps pasting as text, as in a note). */
export function pastedChatImages(files: readonly File[], types: readonly string[]): File[] {
  if (types.includes("text/plain") || types.includes("text/html")) return [];
  return files.filter((file) => file.type.startsWith("image/"));
}

/** Attach images to a tab's draft and type their tags where the caret was —
 * or at the end when the composer isn't focused (a drop, the + picker). */
export function attachToChatDraft(
  tabId: string,
  attached: readonly ChatImageAttachment[],
  input: HTMLTextAreaElement | null,
): void {
  const store = useChatDrafts.getState();
  const draft = chatDraftFor(store.drafts, tabId);
  const focused = input !== null && document.activeElement === input;
  const caret = focused ? input.selectionStart : draft.message.length;
  const next = insertImageTags(draft.message, caret, draft.images.length + 1, attached.length);
  store.setImages(tabId, [...draft.images, ...attached]);
  store.setMessage(tabId, next.text);
  if (focused) requestAnimationFrame(() => input.setSelectionRange(next.caret, next.caret));
}

/** Remove one attached image (0-based) with its tag; later tags number down. */
export function removeChatDraftImage(tabId: string, index: number): void {
  const store = useChatDrafts.getState();
  const draft = chatDraftFor(store.drafts, tabId);
  store.setImages(
    tabId,
    draft.images.filter((_, i) => i !== index),
  );
  store.setMessage(tabId, removeImageTag(draft.message, index + 1));
}
