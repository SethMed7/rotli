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
  corpusSwitchVault,
  memexDetect,
  memexListChats,
  memexPickFolder,
  memexReadChat,
  memexReadContract,
  memexValidate,
  memexArchiveChat,
  memexRevealChat,
  memexDeleteChat,
  memexRenameChat,
  memexWriteChat,
  memexWriteNote,
} from "../lib/tauri";
import { isRevisionConflict } from "../lib/trackedWrite";
import { titleOf } from "../services/derive";
import { setChatModel } from "./chatModelFrontmatter";
import { CHAT_NAME_ATTEMPTS, isChatNameTaken, numberedChatSlug } from "./chatNames";
import { chatMemoryNote, setChatMemoryNote } from "./chatNotePointers";
import { parseTranscriptTurns } from "./chatTranscript";
import { type MemexConfig, type MemexInstance, type Perms, fromCorpusConfig } from "./config";
import {
  addChatArtifact,
  addChatArtifactTurn,
  appendMessages,
  parsePrimaryUser,
  canWrite,
  type ChatArtifact,
  type ChatMsg,
  chatSlug,
  composeMessageLines,
  composeNewChat,
  composeNote,
  type NoteMeta,
  noteStem,
  today,
  ROTLI_SOURCE,
  setAttachedTo,
  setChatPinned,
  setChatSecureContext,
  setChatTitle,
  SPINE,
  ulid,
} from "./contract";

export type { DetectedMemex } from "../lib/tauri";

/** Re-reads a lost chat-file revision race gets before the error surfaces. */
const CHAT_WRITE_ATTEMPTS = 3;

// ── the Location config (corpus + connected brains) ───────────────────────────

export async function loadConfig(): Promise<MemexConfig> {
  return fromCorpusConfig(await corpusListConfig());
}

export const detect = (): Promise<DetectedMemex[]> => memexDetect();

/** "Choose folder…" — repoint the live corpus (smart: memex / move / plain).
 * False when the picker is cancelled. */
export const chooseFolder = (path?: string): Promise<boolean> => corpusChooseFolder(path);

/** Ask for a vault folder in the macOS panel: null when the person cancels.
 * A host build's Rust side refuses a folder Rotli already uses as a vault,
 * in the host's own words (src-tauri/src/app_identity.rs); the rejection
 * reaches the person as Rust words it. */
export const pickVaultFolder = (title: string): Promise<string | null> => memexPickFolder(title);

/** Switch to a vault already registered with Rotli. The backend resolves its
 * trusted path by id and rebinds the live default store. */
export const switchVault = (id: string): Promise<boolean> => corpusSwitchVault(id);

/** Register an existing memex as a future vault switch target. */
export const connectBrain = (path?: string): Promise<boolean> => corpusConnectBrain(path);

/** Onboarding "create a new brain": scaffold a fresh memex at `path` and make it
 * the live corpus (the corpus IS a memex). */
export const initMemexAsCorpus = (path: string, brainEnabled = true): Promise<string> =>
  corpusInitMemex(path, brainEnabled);

/** Remove a connected vault binding. Returns the refreshed config. */
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
  /** One-way information-flow taint. It is applied to the same bytes as this
   * turn, never as a follow-up write. Rust independently preserves it. */
  secureContext?: boolean;
}

export async function writeChat(input: WriteChatInput): Promise<{ slug: string; path: string }> {
  const { instance } = input;
  const slug = input.existingSlug ?? input.slug ?? chatSlug({ title: input.title, source: ROTLI_SOURCE });
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
  }
  const date = today();
  // Each call represents one real send/receive boundary. Stamp missing turns
  // here, at the persistence seam, so every caller gets durable original-time
  // semantics without relying on presentation code to remember it.
  const sentAt = new Date().toISOString();
  const messages = input.messages.map((message) => ({ ...message, at: message.at ?? sentAt }));
  if (input.existingSlug) {
    // Appending a turn is safe to redo: a conflict means another writer (a new
    // chat's model/provider frontmatter, its note link) landed first, and our
    // write did not — a message never drops on a race (2026-09-29).
    const path = await rewriteChat(instance, slug, (existing) => {
      const next = appendMessages(existing, messages, date);
      return input.secureContext ? setChatSecureContext(next) : next;
    });
    return { slug, path: path ?? `${instance.root}/${rel}` };
  }
  // A new chat never replaces one with the same name: each store's create is
  // exclusive and refuses a taken name, and the next name is tried (chat audit
  // 2026-11-24, D1). There is no look-then-write window. The bytes are
  // composed per name because the `id:` line carries it.
  for (let n = 1; ; n += 1) {
    const candidate = numberedChatSlug(slug, n);
    let contents = composeNewChat(
      {
        title: input.title,
        source: ROTLI_SOURCE,
        slug: candidate,
        ...(input.attachedTo ? { attachedTo: input.attachedTo } : {}),
      },
      messages,
      date,
    ).contents;
    if (input.secureContext) contents = setChatSecureContext(contents);
    try {
      const path = await memexWriteChat(instance.root, candidate, contents, null);
      return { slug: candidate, path };
    } catch (error) {
      if (n >= CHAT_NAME_ATTEMPTS || !isChatNameTaken(error)) throw error;
    }
  }
}

/** Point an EXISTING chat at the chat-made note that holds its conversation
 * notes, when the note it is attached to is the person's (contract.ts
 * setChatMemoryNote). */
export async function setChatMemoryNoteStem(
  instance: MemexInstance,
  slug: string,
  stem: string,
): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
  }
  await rewriteChat(instance, slug, (contents) => setChatMemoryNote(contents, stem));
}

/** The chat's own conversation-notes note, when it has one apart from the
 * note it is attached to. */
export async function readChatMemoryNoteStem(instance: MemexInstance, slug: string): Promise<string | null> {
  return chatMemoryNote((await memexReadChat(instance.root, slug)).contents);
}

/** Point an EXISTING chat at its attached note (`attachedTo: [[<stem>]]`) —
 * the header note-toggle's lazy link, written after the note materializes. */
export async function setChatAttachedTo(instance: MemexInstance, slug: string, stem: string): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
  }
  await rewriteChat(instance, slug, (contents) => setAttachedTo(contents, stem));
}

/** Take a held-back exchange off the end of a chat file (the person's turn and
 * Rotli's "⚠" notice after it), so "Send anyway" or "Edit message" replaces it
 * instead of leaving a duplicate. Anything else at the end: unchanged. */
export function withoutTrailingBlockedExchange(contents: string): string {
  const [ask, notice] = parseTranscriptTurns(contents).slice(-2);
  if (!ask || !notice || ask.speaker !== "you" || notice.speaker !== "rotli") return contents;
  return notice.text.startsWith("⚠") ? contents.slice(0, ask.start) : contents;
}

export async function dropBlockedExchange(instance: MemexInstance, slug: string): Promise<void> {
  await rewriteChat(instance, slug, withoutTrailingBlockedExchange);
}

/** Take the person's turn stamped `at` off the end of a chat file, when the
 * file ends with exactly that turn as it was written. A turn-shaped line
 * pasted into the message can't hide it, and anything written after it (a
 * reply, another send) keeps the file unchanged. */
export function withoutStoppedTurn(contents: string, at: string, text: string): string {
  const written = composeMessageLines([{ speaker: "you", text, at }], at).trimEnd();
  const turn = parseTranscriptTurns(contents).find(
    (candidate) =>
      candidate.speaker === "you" &&
      candidate.at === at &&
      contents.slice(candidate.start).trimEnd() === written,
  );
  return turn ? contents.slice(0, turn.start) : contents;
}

/** Stop before any reply arrived: the turn leaves the screen and goes back to
 * the composer, so it leaves the file too. Otherwise it came back on reopen
 * with no reply, and sending it again doubled it (chat audit 2026-11-24, D4). */
export async function dropStoppedTurn(
  instance: MemexInstance,
  slug: string,
  turn: { at: string; text: string },
): Promise<void> {
  await rewriteChat(instance, slug, (contents) => withoutStoppedTurn(contents, turn.at, turn.text));
}

/** Make a stopped turn's file match the screen: a partial answer Stop kept is
 * saved as the reply, otherwise the person's turn comes off. */
export async function settleStoppedTurn(
  instance: MemexInstance,
  slug: string,
  turn: { userAt: string; userText: string; partial: string | null; at: string; secureContext: boolean },
): Promise<void> {
  if (!turn.partial) return dropStoppedTurn(instance, slug, { at: turn.userAt, text: turn.userText });
  await writeChat({
    instance,
    existingSlug: slug,
    title: slug,
    messages: [{ speaker: "rotli", text: turn.partial, at: turn.at }],
    secureContext: turn.secureContext,
  });
}

/** Rewrite one existing chat file through a pure edit. Another writer may land
 * first (a new chat's model/provider frontmatter is written in the
 * background); a lost revision race re-reads and applies the edit again
 * instead of dropping it (2026-09-29). An edit that changes nothing writes
 * nothing and returns null; otherwise the written path. */
async function rewriteChat(
  instance: MemexInstance,
  slug: string,
  edit: (contents: string) => string,
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    const existing = await memexReadChat(instance.root, slug);
    const next = edit(existing.contents);
    if (next === existing.contents) return null;
    try {
      return await memexWriteChat(instance.root, slug, next, existing.revision);
    } catch (error) {
      if (attempt >= CHAT_WRITE_ATTEMPTS || !isRevisionConflict(error)) throw error;
    }
  }
}

/** Record WHO answers an existing chat in its own file (`model:` and
 * `provider:` frontmatter) — the durable twin of the settings.json map, so a
 * copied or connected vault shows each chat's mark without that map. */
export async function setChatModelMeta(
  instance: MemexInstance,
  slug: string,
  model: string,
  provider: string | null,
): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) return; // a read-only vault keeps its files as they are
  await rewriteChat(instance, slug, (contents) => setChatModel(contents, model, provider));
}

export const listChats = (instance: MemexInstance): Promise<MemexChatSummary[]> =>
  memexListChats(instance.root);

export const readChat = (instance: MemexInstance, slug: string): Promise<string> =>
  memexReadChat(instance.root, slug).then((chat) => chat.contents);

/** Attach a durable artifact navigation reference to an existing chat. This is
 * an additive/idempotent merge, so a revision race can be safely re-read and
 * retried without replacing a newer transcript. */
export async function registerChatArtifact(
  instance: MemexInstance,
  slug: string,
  artifact: ChatArtifact,
): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await memexReadChat(instance.root, slug);
    const next = addChatArtifact(existing.contents, artifact);
    if (next === existing.contents) return;
    try {
      await memexWriteChat(instance.root, slug, next, existing.revision);
      return;
    } catch (error) {
      if (attempt === 0 && /revision conflict/i.test(String(error))) continue;
      throw error;
    }
  }
}

/** Bind artifacts to the assistant response that created them. */
export async function registerChatArtifactTurn(
  instance: MemexInstance,
  slug: string,
  assistant: number,
  artifacts: readonly ChatArtifact[],
): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await memexReadChat(instance.root, slug);
    const next = addChatArtifactTurn(existing.contents, assistant, artifacts);
    if (next === existing.contents) return;
    try {
      await memexWriteChat(instance.root, slug, next, existing.revision);
      return;
    } catch (error) {
      if (attempt === 0 && /revision conflict/i.test(String(error))) continue;
      throw error;
    }
  }
}

/** Rename a chat (chats/<old>.md → chats/<new>.md). Returns the new slug. Refused
 * unless the chats surface is writable for this instance. */
export async function renameChat(instance: MemexInstance, oldSlug: string, newSlug: string): Promise<string> {
  if (!canWrite(`chats/${newSlug}.md`, instance.perms)) {
    throw new Error("this vault is read-only — can't rename a chat here");
  }
  return memexRenameChat(instance.root, oldSlug, newSlug);
}

/** Change a chat's display title while keeping its durable filename identity.
 * Revision conflicts get one fresh read, matching the other frontmatter edits. */
export async function updateChatTitle(instance: MemexInstance, slug: string, title: string): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("this vault is read-only — can't rename a chat here");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await memexReadChat(instance.root, slug);
    const next = setChatTitle(existing.contents, title);
    if (next === existing.contents) return;
    try {
      await memexWriteChat(instance.root, slug, next, existing.revision);
      return;
    } catch (error) {
      if (attempt === 0 && /revision conflict/i.test(String(error))) continue;
      throw error;
    }
  }
}

/** Soft-delete a chat (→ hidden chats/trash/, recoverable in Finder). */
export async function deleteChat(instance: MemexInstance, slug: string): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("this vault is read-only — can't delete a chat here");
  }
  await memexDeleteChat(instance.root, slug);
}

/** Archive a chat (→ hidden chats/archive/). */
export async function archiveChat(instance: MemexInstance, slug: string): Promise<void> {
  if (!canWrite(`chats/${slug}.md`, instance.perms)) {
    throw new Error("this vault is read-only — can't archive a chat here");
  }
  await memexArchiveChat(instance.root, slug);
}

/** Reveal a chat's file in Finder — read-only, no perms gate needed. */
export async function revealChat(instance: MemexInstance, slug: string): Promise<void> {
  await memexRevealChat(instance.root, slug);
}

/** Pin/unpin a chat (frontmatter `pinned:` — the sidebar sorts pinned first). */
export async function pinChat(instance: MemexInstance, slug: string, pinned: boolean): Promise<void> {
  const rel = `chats/${slug}.md`;
  if (!canWrite(rel, instance.perms)) {
    throw new Error("this vault is read-only — can't pin a chat here");
  }
  const existing = await memexReadChat(instance.root, slug);
  const next = setChatPinned(existing.contents, pinned);
  if (next !== existing.contents) {
    await memexWriteChat(instance.root, slug, next, existing.revision);
  }
}

// ── notes (Librarian intake or the raw vault's wiki root) ──────────────────────

export interface WriteNoteInput {
  instance: MemexInstance;
  /** The note body (markdown; its first heading is the title). */
  body: string;
  /** The user's folder(s) for the projected view. `["Inbox"]` is the CAPTURE
   * shelf — Rust projects it to the Captures board — so only a capture
   * writes it; every other writer names its shelf or passes `[]` (2026-09-17:
   * chat notes had defaulted to Inbox and filled Captures). */
  shelf: string[];
  /** Who may access it; default: the brain's primary user (owner-only). */
  reach?: string[];
  /** Mark the file secure at birth; local-AI access remains denied by default. */
  secure?: boolean;
  /** Which AI made the note; absent for a person (NoteMeta.createdBy). */
  createdBy?: NoteMeta["createdBy"];
}

/** Write a brand-new note through the active memex's creation policy: `wiki/_inbox/`
 *  with the Librarian enabled, or the `wiki/` root when it is off. AI metadata
 *  (area/summary/tags/links) is left blank. The `id` is set once and never changes.
 *  Returns the new note's id, filename stem, and absolute path. */
export async function writeNote(input: WriteNoteInput): Promise<{ id: string; stem: string; path: string }> {
  const { instance } = input;
  const id = ulid();
  const title = titleOf(input.body);
  const stem = noteStem(title, id);
  const rel = `${input.secure ? SPINE.wikiSecure : SPINE.wikiInbox}/${stem}.md`;
  // TS gate first (the Rust assert_writable is the second layer).
  if (!canWrite(rel, instance.perms)) {
    throw new Error("This vault is read-only for rotli — connect it with write access first.");
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
    shelf: input.shelf,
    reach,
    ...(input.secure ? { secure: true } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  };
  const contents = composeNote(meta, input.body, today());
  const path = await memexWriteNote(instance.root, stem, contents);
  const actualStem = path.split("/").pop()?.replace(/\.md$/, "") || stem;
  return { id, stem: actualStem, path };
}

// ── validate.ts gate (mirror-not-import: Rust shells the brain's own script) ──

export const runValidate = (instance: MemexInstance): Promise<MemexValidateReport> =>
  memexValidate(instance.root);
