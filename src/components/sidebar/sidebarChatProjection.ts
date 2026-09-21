export function visibleSidebarChats<T extends { slug: string }>(
  chats: readonly T[],
  activeViewSlugs: readonly string[] | null,
): T[] {
  if (activeViewSlugs === null) return [...chats];
  // a view shows ITS chats — none is none (the owner, 2026-09-21: "chats need
  // to respect the view too — this view should have no chats"); Main is every chat
  const visible = new Set(activeViewSlugs);
  return chats.filter((chat) => visible.has(chat.slug));
}

/** Compact activity label for a narrow sidebar row. Wall-clock skew fails
 * quietly to `now`; a future timestamp must never render as a huge age. */
export function relativeChatAge(nowMs: number, modifiedMs: number): string {
  const elapsed = Math.max(0, nowMs - modifiedMs);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
