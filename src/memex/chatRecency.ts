// When a chat last heard back — the sidebar's order (the owner, 2026-10-15:
// sending leaves a chat in place; the arriving reply lifts it). The TS twin of
// src-tauri/src/memex_chat_scan.rs `last_reply_ms`, for Rotli Web, over the
// message lines contract.ts composeMessageLines writes.

/** When the transcript's newest REPLY was written (ms; 0 = none). A reply is
 * any message line whose speaker is not "you"; a bare-date stamp (turns
 * written before per-message times) reads as that day's UTC midnight. */
export function lastReplyMs(contents: string): number {
  const lines = contents.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^\*\*(.+?)\*\* · (\S+) — /.exec(lines[i] ?? "");
    if (!match || match[1] === "you") continue;
    const stamp = match[2] ?? "";
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(stamp) ? `${stamp}T00:00:00Z` : stamp);
    if (Number.isFinite(ms)) return Math.max(0, ms);
  }
  return 0;
}
