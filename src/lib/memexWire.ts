// The memex commands' wire shapes (src-tauri/src/memex.rs), split from
// src/lib/tauri.ts, which re-exports them; the calls stay there.

/** A folder probed for a memex signature (the memex.json `mx_` marker). */
export interface DetectedMemex {
  root: string;
  label: string;
  /** "memex" (real, mx_ memex.json) · "plain" (a dir, no valid memex.json) ·
   * "fresh" (empty/absent — safe to init). */
  kind: "memex" | "plain" | "fresh";
  memexId: string | null;
  contract: string | null;
  hasUsersJson: boolean;
  /** Raw users.json contents (TS parses access mode with the mirror codec). */
  usersJson: string | null;
}

export interface MemexContractRaw {
  memexJson: string;
  usersJson: string;
  identitiesJson: string;
}

export interface MemexChatSummary {
  slug: string;
  title: string;
  source: string;
  attachedTo: string;
  path: string;
  /** fs mtime in ms (0 when unreadable) — ⌥A summon-chat picks the newest. */
  modifiedMs: number;
  /** When the newest reply landed (ms; 0 = no reply yet, or one longer than
   * the listing's tail window) — the sidebar's order (chatActivityMs). */
  repliedMs: number;
  /** `pinned: true` frontmatter — the sidebar sorts pinned chats first. */
  pinned: boolean;
  /** `model:` / `provider:` frontmatter — who answers this chat, in the file
   * itself (2026-09-17); "" when the chat predates them. */
  model: string;
  provider: string;
}

export interface MemexValidateReport {
  ok: boolean;
  skipped: boolean;
  stdout: string;
  errors: number;
  warnings: number;
}
