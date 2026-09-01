import { IMAGE_EXTS, extOf, fileName } from "./fileKind";

/** The image types Chat may copy into the user-owned asset lane. Rust validates
 * the same list independently; parity.json prevents one side drifting. */
export const CHAT_IMAGE_ASSET_EXTS = [...IMAGE_EXTS] as readonly string[];

/** Largest image Chat copies into the asset lane, in bytes. Rust enforces the
 * same ceiling on the byte-backed lane and the read-back cap; parity.json keeps
 * the two equal so a dropped file can never be silently truncated mid-read. */
export const CHAT_IMAGE_ASSET_MAX_BYTES = 25_000_000;

export type ChatWorkKind = "image" | "artifact";
export type ChatWorkSource = "attachment" | "generated";

export interface ChatWorkItem {
  id: string;
  kind: ChatWorkKind;
  name: string;
  source: ChatWorkSource;
  surfaceKind: "note" | "canvas" | "file";
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
const ROTLI_LINK = /\[([^\]]+)]\(rotli:\/\/open\?id=([^&\s)]+)&kind=(note|board|file)\)/g;

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

function itemOf(
  id: string,
  source: ChatWorkSource,
  surface?: ChatWorkItem["surfaceKind"],
  label?: string,
): ChatWorkItem {
  const ext = extOf(id);
  return {
    id,
    kind: IMAGE_EXTS.has(ext) ? "image" : "artifact",
    name: label?.trim() || fileName(id),
    source,
    surfaceKind: surface ?? (ext === "md" ? "note" : ext === "excalidraw" ? "canvas" : "file"),
  };
}

/** A standard, portable Markdown link is the durable chat↔file relationship.
 * The root id stays machine-local; the chat stores only its memex-relative
 * `storage:` path. */
export function attachmentReference(index: number, wireId: string): string {
  return `[Image #${index}](storage:${encodeStoragePath(relativeWireId(wireId))})`;
}

/** Durable links appended by presentation after a creation tool succeeds. Files
 * use the portable storage shorthand; note/board identities use Rotli's
 * existing validated deep-link contract. */
export function artifactReference(
  label: string,
  wireId: string,
  surfaceKind: ChatWorkItem["surfaceKind"],
): string {
  const safeLabel =
    label
      .replaceAll("[", " ")
      .replaceAll("]", " ")
      .replace(/[\n\r]/g, " ")
      .trim() || fileName(wireId);
  if (surfaceKind === "file" && /(^|:)storage\//i.test(wireId)) {
    return `[${safeLabel}](storage:${encodeStoragePath(relativeWireId(wireId))})`;
  }
  const kind = surfaceKind === "canvas" ? "board" : surfaceKind;
  return `[${safeLabel}](rotli://open?id=${encodeURIComponent(wireId)}&kind=${kind})`;
}

/** User bubbles keep the familiar image handle while the ordinary Markdown
 * file retains the durable storage target. */
export function visibleChatText(text: string): string {
  return text.replace(STORAGE_LINK, "[$1]").replace(ROTLI_LINK, "[$1]");
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
    for (const match of message.text.matchAll(ROTLI_LINK)) {
      const id = decodeStoragePath(match[2] ?? "");
      const kind = match[3] === "board" ? "canvas" : match[3] === "note" ? "note" : "file";
      if (id) add(itemOf(id, "generated", kind, match[1]));
    }
  }
  for (const id of input.attachmentIds ?? []) add(itemOf(id, "attachment"));
  for (const id of input.discoveredIds) add(itemOf(id, "generated"));
  return items;
}
