// Rotli Web: where chats live when there is no Rust corpus. The Mac app keeps
// every chat as `chats/<slug>.md` in the vault (memex_* commands); on the web
// the same file contents — composed by the memex contract — are kept in the
// browser vault under `chat:<slug>`, revision-gated like every other key, so
// a chat survives a reload and two tabs cannot clobber one another.

import type { VaultStore } from "../lib/browserVault";
import { BrowserVault, RevisionConflict, browserVault } from "../lib/browserVault";
import type { MemexChatSummary } from "../lib/tauri";
import type { WebMemexBridge } from "../lib/webAiSeam";

const INDEX_KEY = "chat-index";
const FOLDERS_KEY = "chat-folders";
const chatKey = (slug: string) => `chat:${slug}`;
/** Removed chats keep their transcript here, the way Rust moves a chat file to
 * the vault's Trash or Archive instead of deleting it. */
const removedKey = (bin: "trash" | "archive", slug: string) => `chat-${bin}:${slug}`;
const INDEX_RETRIES = 4;

function frontmatterField(contents: string, name: string): string {
  const block = contents.startsWith("---\n") ? contents.slice(4, contents.indexOf("\n---", 4)) : "";
  const line = block.split("\n").find((l) => l.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : "";
}

/** The sidebar row for one stored chat, read the way Rust reads the file. */
export function summarize(slug: string, contents: string, modifiedMs: number): MemexChatSummary {
  const attached = frontmatterField(contents, "attachedTo").replace(/^\[\[|\]\]$/g, "");
  return {
    slug,
    title: frontmatterField(contents, "title") || slug,
    source: frontmatterField(contents, "source"),
    attachedTo: attached,
    path: `chats/${slug}.md`,
    modifiedMs,
    pinned: frontmatterField(contents, "pinned") === "true",
  };
}

interface IndexEntry {
  slug: string;
  modifiedMs: number;
}

function parseIndex(raw: string | undefined): IndexEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IndexEntry[]).filter((e) => typeof e?.slug === "string") : [];
  } catch {
    return [];
  }
}

/** The chat store over one vault; the bridge below routes the memex commands to it. */
export class WebChatStore {
  constructor(private readonly vault: BrowserVault) {}

  private async index(): Promise<IndexEntry[]> {
    return parseIndex(await this.vault.read(INDEX_KEY));
  }

  /** Revision-gated read-modify-write: two tabs saving different chats at
   * once both land, the loser retrying on the winner's index. */
  private async touch(slug: string, remove = false): Promise<void> {
    for (let attempt = 0; attempt < INDEX_RETRIES; attempt += 1) {
      const stored = await this.vault.readVersioned(INDEX_KEY);
      const rest = parseIndex(stored.contents).filter((e) => e.slug !== slug);
      const next = remove ? rest : [{ slug, modifiedMs: Date.now() }, ...rest];
      try {
        await this.vault.writeVersioned(INDEX_KEY, JSON.stringify(next), stored.revision);
        return;
      } catch (reason) {
        if (!(reason instanceof RevisionConflict)) throw reason;
      }
    }
    throw new Error("the chat list kept changing in another tab — try again");
  }

  async list(): Promise<MemexChatSummary[]> {
    const entries = await this.index();
    const rows = await Promise.all(
      entries.map(async (e) => {
        const contents = await this.vault.read(chatKey(e.slug));
        return contents === undefined ? null : summarize(e.slug, contents, e.modifiedMs);
      }),
    );
    return rows.filter((r): r is MemexChatSummary => r !== null);
  }

  async read(slug: string): Promise<{ contents: string; revision: string }> {
    const stored = await this.vault.readVersioned(chatKey(slug));
    if (!stored.contents) throw new Error(`unknown chat "${slug}"`);
    return stored;
  }

  /** Rust's contract: a new chat presents no revision and refuses to overwrite. */
  async write(slug: string, contents: string, expectedRevision: string | null): Promise<string> {
    let expected = expectedRevision;
    if (expected === null) {
      const existing = await this.vault.readVersioned(chatKey(slug));
      if (existing.contents) throw new Error(`a chat named "${slug}" already exists`);
      // a removed chat's key is gone (see remove), so a fresh slug starts at "0"
      expected = existing.revision;
    }
    try {
      await this.vault.writeVersioned(chatKey(slug), contents, expected);
    } catch (reason) {
      if (reason instanceof RevisionConflict)
        throw new Error("This chat changed in another tab — reopen it.");
      throw reason;
    }
    await this.touch(slug);
    return `chats/${slug}.md`;
  }

  /** Trash or archive: the transcript moves to a recoverable key, the live
   * key and its revision go away (so the slug can be born again), and the
   * chat leaves the list. */
  async remove(slug: string, bin: "trash" | "archive" = "trash"): Promise<void> {
    const live = await this.vault.read(chatKey(slug));
    if (live) await this.vault.write(removedKey(bin, slug), live);
    await this.vault.store.delete(chatKey(slug));
    await this.vault.store.delete(`${chatKey(slug)}#rev`);
    await this.touch(slug, true);
  }

  /** A removed transcript, for a future Trash/Archive front on the web. */
  recoverable(slug: string, bin: "trash" | "archive"): Promise<string | undefined> {
    return this.vault.read(removedKey(bin, slug));
  }

  folders(): Promise<{ contents: string; revision: string }> {
    return this.vault.readVersioned(FOLDERS_KEY);
  }

  writeFolders(contents: string, expectedRevision: string): Promise<string> {
    return this.vault.writeVersioned(FOLDERS_KEY, contents, expectedRevision);
  }
}

/** The memex commands the web answers itself; the rest stay in the Mac app. */
export function webMemexBridge(store: WebChatStore): WebMemexBridge {
  const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
  return (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    const slug = text(a.slug);
    switch (cmd) {
      case "memex_list_chats":
        return store.list();
      case "memex_read_chat":
        return store.read(slug);
      case "memex_write_chat":
        return store.write(
          slug,
          text(a.contents),
          a.expectedRevision === null ? null : text(a.expectedRevision, "0"),
        );
      case "memex_delete_chat":
        return store.remove(slug, "trash");
      case "memex_archive_chat":
        return store.remove(slug, "archive");
      case "memex_chat_folders":
        return store.folders();
      case "memex_write_chat_folders":
        return store.writeFolders(text(a.contents), text(a.expectedRevision, "0"));
      default:
        return Promise.reject(new Error(`${cmd}: not available on the web`));
    }
  };
}

export function createWebChatStore(store?: VaultStore): WebChatStore {
  return new WebChatStore(store ? new BrowserVault(store) : browserVault());
}
