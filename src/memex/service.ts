// The memex service seam — the ONE place the app crosses from the contract codec
// (contract.ts) to the Rust I/O (lib/tauri.ts). It composes the file bytes with
// the mirror codec, enforces the write gate BEFORE touching Rust (the Rust guard
// is the second layer), and applies the access-mode/contract reads. Components
// never call lib/tauri's memex_* directly — they go through useMemex hooks.

import {
  type DetectedMemex,
  type MemexChatSummary,
  type MemexDirEntry,
  type MemexValidateReport,
  memexAppendInbox,
  memexConnect,
  memexDetect,
  memexInit,
  memexInspect,
  memexListChats,
  memexListDir,
  memexListInstances,
  memexPickFolder,
  memexRead,
  memexReadContract,
  memexSetActive,
  memexSetPerms,
  memexValidate,
  memexWriteChat,
} from "../lib/tauri";
import {
  type ChatMsg,
  ROTLI_SOURCE,
  appendMessages,
  canWrite,
  chatSlug,
  composeInboxLine,
  composeNewChat,
  contractInRange,
  parseAccessMode,
  parseMemexInfo,
  today,
} from "./contract";
import { type MemexConfig, type MemexInstance, type Perms, fromRegistry } from "./config";

export type { DetectedMemex } from "../lib/tauri";

// ── instances ────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<MemexConfig> {
  return fromRegistry(await memexListInstances());
}

export const detect = (): Promise<DetectedMemex[]> => memexDetect();
export const inspect = (path: string): Promise<DetectedMemex> => memexInspect(path);
export const pickFolder = (): Promise<string | null> => memexPickFolder();

/** Connect (Merge) to an existing memex. Returns the refreshed config. */
export async function connect(path: string, label: string): Promise<MemexConfig> {
  await memexConnect(path, label);
  return loadConfig();
}

/** Initiate (Separate / fresh) a new memex at an empty folder. */
export async function init(path: string, label: string): Promise<MemexConfig> {
  await memexInit(path, label);
  return loadConfig();
}

export async function setActive(id: string): Promise<MemexConfig> {
  await memexSetActive(id);
  return loadConfig();
}

export async function setPerms(id: string, perms: Perms): Promise<MemexConfig> {
  await memexSetPerms(id, perms);
  return loadConfig();
}

// ── a probe's contract, parsed with the mirror codec (for the UI to explain) ──

export interface MemexProbe {
  detected: DetectedMemex;
  accessMode: ReturnType<typeof parseAccessMode>;
  contractOk: boolean;
}

export async function probe(path: string): Promise<MemexProbe> {
  const detected = await inspect(path);
  const accessMode = parseAccessMode(detected.usersJson ?? "");
  const contractOk = detected.contract ? contractInRange(detected.contract) : false;
  return { detected, accessMode, contractOk };
}

// ── chats (rotli's owned surface) ─────────────────────────────────────────────

export interface WriteChatInput {
  instance: MemexInstance;
  title: string;
  attachedTo?: string;
  messages: ChatMsg[];
  /** Append to this existing chat instead of creating a new one. */
  existingSlug?: string;
}

export async function writeChat(input: WriteChatInput): Promise<{ slug: string; path: string }> {
  const { instance } = input;
  const slug = input.existingSlug ?? chatSlug({ title: input.title, source: ROTLI_SOURCE });
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This memex is read-only for rotli — connect it with write access first.");
  }
  const date = today();
  let contents: string;
  if (input.existingSlug) {
    const existing = await memexRead(instance.root, rel);
    contents = appendMessages(existing, input.messages, date);
  } else {
    contents = composeNewChat(
      { title: input.title, source: ROTLI_SOURCE, slug, ...(input.attachedTo ? { attachedTo: input.attachedTo } : {}) },
      input.messages,
      date,
    ).contents;
  }
  const path = await memexWriteChat(instance.root, slug, contents);
  return { slug, path };
}

export const listChats = (instance: MemexInstance): Promise<MemexChatSummary[]> =>
  memexListChats(instance.root);

export const readChat = (instance: MemexInstance, slug: string): Promise<string> =>
  memexRead(instance.root, `chats/${slug}.md`);

// ── inbox capture (rotli's other writable surface) ────────────────────────────

export async function captureToInbox(
  instance: MemexInstance,
  text: string,
  tag?: string,
): Promise<void> {
  if (!canWrite("inbox.md", instance.perms)) {
    throw new Error("This memex is read-only for rotli.");
  }
  await memexAppendInbox(instance.root, composeInboxLine(text, tag));
}

// ── read-only spine (Memory) ──────────────────────────────────────────────────

export const readSpine = (instance: MemexInstance, rel: string): Promise<string> =>
  memexRead(instance.root, rel);

/** List a spine directory (subdirs + .md files) for the read-only browser. */
export const listDir = (instance: MemexInstance, rel: string): Promise<MemexDirEntry[]> =>
  memexListDir(instance.root, rel);

/** The instance's identity card, parsed from the live memex.json. */
export async function readInfo(instance: MemexInstance) {
  const raw = await memexReadContract(instance.root);
  return {
    info: parseMemexInfo(raw.memexJson),
    accessMode: parseAccessMode(raw.usersJson),
  };
}

// ── validate.ts gate (mirror-not-import: Rust shells the brain's own script) ──

export const runValidate = (instance: MemexInstance): Promise<MemexValidateReport> =>
  memexValidate(instance.root);
