// Chat file names that never replace one another (chat audit 2026-11-24, D1
// and D2). Pure: the stores and the service share it.

/** The longest chat name the stores accept (Rust `safe_slug`). */
const CHAT_SLUG_MAX = 80;
/** Names a new chat, or a removed one's kept copy, tries before giving up. */
export const CHAT_NAME_ATTEMPTS = 1000;

/** The n-th name for a chat: the name itself, then `<name>-2`, `<name>-3`, …
 * cut to fit the 80-character limit. Rust's Trash/Archive moves number the
 * same way (memex.rs `numbered_chat_slug`). */
export function numberedChatSlug(base: string, n: number): string {
  if (n < 2) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, CHAT_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/** Whether a create was refused because a chat already has that name. Rust
 * (`write_chat_at`) and both web stores (`webChats.ts`) say it this way. */
export const isChatNameTaken = (error: unknown): boolean =>
  /\bchat already exists\b/i.test(error instanceof Error ? error.message : String(error));
