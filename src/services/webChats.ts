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

/** The chat store over one vault; the bridge below routes the memex commands to it. */
export class WebChatStore {
  constructor(private readonly vault: BrowserVault) {}

  private async index(): Promise<IndexEntry[]> {
    const raw = await this.vault.read(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as IndexEntry[]).filter((e) => typeof e?.slug === "string") : [];
    } catch {
      return [];
    }
  }

  private async touch(slug: string, remove = false): Promise<void> {
    const rest = (await this.index()).filter((e) => e.slug !== slug);
    const next = remove ? rest : [{ slug, modifiedMs: Date.now() }, ...rest];
    await this.vault.write(INDEX_KEY, JSON.stringify(next));
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
    if (expectedRevision === null) {
      const existing = await this.vault.readVersioned(chatKey(slug));
      if (existing.contents) throw new Error(`a chat named "${slug}" already exists`);
    }
    try {
      await this.vault.writeVersioned(chatKey(slug), contents, expectedRevision ?? "0");
    } catch (reason) {
      if (reason instanceof RevisionConflict)
        throw new Error("This chat changed in another tab — reopen it.");
      throw reason;
    }
    await this.touch(slug);
    return `chats/${slug}.md`;
  }

  async remove(slug: string): Promise<void> {
    await this.vault.write(chatKey(slug), "");
    await this.touch(slug, true);
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
        return store.remove(slug);
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
