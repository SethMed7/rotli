// The memex service seam — the ONE place the app crosses from the contract codec
// (contract.ts) to the Rust I/O (lib/tauri.ts). It composes the file bytes with
// the mirror codec, enforces the write gate BEFORE touching Rust (the Rust guard
// is the second layer), and applies the access-mode/contract reads. Components
// never call lib/tauri's memex_* directly — they go through useMemex hooks.

import {
  type DetectedMemex,
  type MemexChatSummary,
  type MemexValidateReport,
  corpusChooseFolder,
  corpusConnectBrain,
  corpusForgetBrain,
  corpusInitMemex,
  corpusListConfig,
  corpusSetActiveBrain,
  corpusSetBrainPerms,
  memexDetect,
  memexListChats,
  memexPickFolder,
  memexRead,
  memexReadContract,
  memexValidate,
  memexArchiveChat,
  memexDeleteChat,
  memexRenameChat,
  memexWriteChat,
  memexWriteNote,
} from "../lib/tauri";
import {
  type ChatMsg,
  type NoteMeta,
  ROTLI_SOURCE,
  SPINE,
  appendMessages,
  canWrite,
  chatSlug,
  composeNewChat,
  composeNote,
  noteStem,
  parsePrimaryUser,
  setAttachedTo,
  setChatPinned,
  today,
  ulid,
} from "./contract";
import { type MemexConfig, type MemexInstance, type Perms, fromCorpusConfig } from "./config";
import { titleOf } from "../services/derive";

export type { DetectedMemex } from "../lib/tauri";

// ── the Location config (corpus + connected brains) ───────────────────────────

export async function loadConfig(): Promise<MemexConfig> {
  return fromCorpusConfig(await corpusListConfig());
}

export const detect = (): Promise<DetectedMemex[]> => memexDetect();
export const pickFolder = (): Promise<string | null> => memexPickFolder();

/** "Choose folder…" — repoint the corpus (smart: memex / move / plain). Relaunches
 * on success (so it rarely resolves); false when the picker is cancelled. */
export const chooseFolder = (path?: string): Promise<boolean> => corpusChooseFolder(path);

/** Connect an existing memex as a brain. Relaunches on success. */
export const connectBrain = (path?: string): Promise<boolean> => corpusConnectBrain(path);

/** Onboarding "create a new brain": scaffold a fresh memex at `path` and make it
 * the corpus (the corpus IS a memex). Relaunches on success. */
export const initMemexAsCorpus = (path: string): Promise<void> => corpusInitMemex(path);

/** Forget a connected brain (binding only). Returns the refreshed config. */
export async function forget(id: string): Promise<MemexConfig> {
  await corpusForgetBrain(id);
  return loadConfig();
}

export async function setActive(id: string): Promise<MemexConfig> {
  await corpusSetActiveBrain(id);
  return loadConfig();
}

export async function setPerms(id: string, perms: Perms): Promise<MemexConfig> {
  await corpusSetBrainPerms(id, perms);
  return loadConfig();
}

// ── chats (rotli's owned surface) ─────────────────────────────────────────────

export interface WriteChatInput {
  instance: MemexInstance;
  title: string;
  /** Optional caller-owned safe filename identity; the displayed title stays separate. */
  slug?: string;
  attachedTo?: string;
  messages: ChatMsg[];
  /** Append to this existing chat instead of creating a new one. */
  existingSlug?: string;
}

export async function writeChat(input: WriteChatInput): Promise<{ slug: string; path: string }> {
  const { instance } = input;
  const slug = input.existingSlug ?? input.slug ?? chatSlug({ title: input.title, source: ROTLI_SOURCE });
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

/** Point an EXISTING chat at its attached note (`attachedTo: [[<stem>]]`) —
 * the header note-toggle's lazy link, written after the note materializes. */
export async function setChatAttachedTo(
  instance: MemexInstance,
  slug: string,
  stem: string,
): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This memex is read-only for rotli — connect it with write access first.");
  }
  const existing = await memexRead(instance.root, rel);
  const next = setAttachedTo(existing, stem);
  if (next !== existing) await memexWriteChat(instance.root, slug, next);
}

export const listChats = (instance: MemexInstance): Promise<MemexChatSummary[]> =>
  memexListChats(instance.root);

export const readChat = (instance: MemexInstance, slug: string): Promise<string> =>
  memexRead(instance.root, `chats/${slug}.md`);

/** Rename a chat (chats/<old>.md → chats/<new>.md). Returns the new slug. Refused
 * unless the chats surface is writable for this instance. */
export async function renameChat(
  instance: MemexInstance,
  oldSlug: string,
  newSlug: string,
): Promise<string> {
  if (!canWrite(`chats/${newSlug}.md`, instance.perms)) {
    throw new Error("this brain is read-only — can't rename a chat here");
  }
  return memexRenameChat(instance.root, oldSlug, newSlug);
}

/** Soft-delete a chat (→ hidden chats/trash/, recoverable in Finder). */
export async function deleteChat(instance: MemexInstance, slug: string): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("this brain is read-only — can't delete a chat here");
  }
  await memexDeleteChat(instance.root, slug);
}

/** Archive a chat (→ hidden chats/archive/). */
export async function archiveChat(instance: MemexInstance, slug: string): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("this brain is read-only — can't archive a chat here");
  }
  await memexArchiveChat(instance.root, slug);
}

/** Pin/unpin a chat (frontmatter `pinned:` — the sidebar sorts pinned first). */
export async function pinChat(instance: MemexInstance, slug: string, pinned: boolean): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("this brain is read-only — can't pin a chat here");
  }
  const existing = await memexRead(instance.root, rel);
  const next = setChatPinned(existing, pinned);
  if (next !== existing) await memexWriteChat(instance.root, slug, next);
}

// ── notes (rotli's owned wiki/_inbox staging — the v3.5 write model) ───────────

export interface WriteNoteInput {
  instance: MemexInstance;
  /** The note body (markdown; its first heading is the title). */
  body: string;
  /** The user's folder(s) for the projected view; default ["Inbox"]. */
  shelf?: string[];
  /** Who may access it; default: the brain's primary user (owner-only). */
  reach?: string[];
  /** Mark the file secure at birth; local-AI access remains denied by default. */
  secure?: boolean;
}

/** Write a brand-new note into the active memex's `wiki/_inbox/` staging per the v3.5
 *  contract. AI metadata (area/summary/tags/links) is left blank — a later phase's
 *  local LLM classifies + files it to `wiki/<area>/`. The `id` is set once and never
 *  changes. Returns the new note's id, staging stem, and absolute path. */
export async function writeNote(
  input: WriteNoteInput,
): Promise<{ id: string; stem: string; path: string }> {
  const { instance } = input;
  const id = ulid();
  const title = titleOf(input.body);
  const stem = noteStem(title, id);
  const rel = `${input.secure ? SPINE.wikiSecure : SPINE.wikiInbox}/${stem}.md`;
  // TS gate first (the Rust assert_writable is the second layer).
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This memex is read-only for rotli — connect it with write access first.");
  }
  // reach default = the owning user (the brain's primary). Single-tenant / unreadable
  // ⇒ owner-only ([]); never invent a user. (Phase 3 adds the active-user picker.)
  let reach = input.reach;
  if (!reach) {
    const { usersJson } = await memexReadContract(instance.root);
    const primary = parsePrimaryUser(usersJson);
    reach = primary ? [primary] : [];
  }
  const meta: NoteMeta = {
    id,
    title,
    shelf: input.shelf ?? ["Inbox"],
    reach,
    ...(input.secure ? { secure: true } : {}),
  };
  const contents = composeNote(meta, input.body, today());
  const path = await memexWriteNote(instance.root, stem, contents);
  return { id, stem, path };
}

// ── validate.ts gate (mirror-not-import: Rust shells the brain's own script) ──

export const runValidate = (instance: MemexInstance): Promise<MemexValidateReport> =>
  memexValidate(instance.root);
