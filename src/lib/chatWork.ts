import { IMAGE_EXTS, extOf, fileName } from "./fileKind";

/** The image types Chat may copy into the user-owned asset lane. Rust validates
 * the same list independently; parity.json prevents one side drifting. */
export const CHAT_IMAGE_ASSET_EXTS = [...IMAGE_EXTS] as readonly string[];

export type ChatWorkKind = "image" | "artifact";
export type ChatWorkSource = "attachment" | "generated";

export interface ChatWorkItem {
  id: string;
  kind: ChatWorkKind;
  name: string;
  source: ChatWorkSource;
}

interface ChatWorkProjectionInput {
  /** Empty for the local corpus, `<root-id>:` for a connected memex. */
  rootPrefix: string;
  messages: readonly { text: string }[];
  /** Picked images that have been copied into the memex but not sent yet. */
  attachmentIds?: readonly string[];
  /** Files already pinned to this chat's generated-assets directory. */
  discoveredIds: readonly string[];
}

const STORAGE_LINK = /\[([^\]]+)]\((storage:[^)\s]+)\)/g;

function relativeWireId(id: string): string {
  const colon = id.indexOf(":");
  const rel = colon > 0 && !id.slice(0, colon).includes("/") ? id.slice(colon + 1) : id;
  return rel.replace(/^storage\//i, "");
}

function decodeStoragePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function itemOf(id: string, source: ChatWorkSource): ChatWorkItem {
  return {
    id,
    kind: IMAGE_EXTS.has(extOf(id)) ? "image" : "artifact",
    name: fileName(id),
    source,
  };
}

/** A standard, portable Markdown link is the durable chat↔file relationship.
 * The root id stays machine-local; the chat stores only its memex-relative
 * `storage:` path. */
export function attachmentReference(index: number, wireId: string): string {
  return `[Image #${index}](storage:${encodeStoragePath(relativeWireId(wireId))})`;
}

/** User bubbles keep the familiar image handle while the ordinary Markdown
 * file retains the durable storage target. */
export function visibleChatText(text: string): string {
  return text.replace(STORAGE_LINK, "[$1]");
}

/** Build the rail from portable links in the transcript plus files in the
 * chat's generated-assets lane. Transcript order wins; path identity dedupes. */
export function projectChatWorkItems(input: ChatWorkProjectionInput): ChatWorkItem[] {
  const items: ChatWorkItem[] = [];
  const seen = new Set<string>();
  const add = (item: ChatWorkItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  for (const message of input.messages) {
    for (const match of message.text.matchAll(STORAGE_LINK)) {
      const label = match[1] ?? "";
      const src = match[2] ?? "";
      const rel = `storage/${decodeStoragePath(src.slice("storage:".length))}`;
      add(itemOf(`${input.rootPrefix}${rel}`, /^Image #\d+$/i.test(label) ? "attachment" : "generated"));
    }
  }
  for (const id of input.attachmentIds ?? []) add(itemOf(id, "attachment"));
  for (const id of input.discoveredIds) add(itemOf(id, "generated"));
  return items;
}
