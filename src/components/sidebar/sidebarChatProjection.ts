export function visibleSidebarChats<T extends { slug: string }>(
  chats: readonly T[],
  activeViewSlugs: readonly string[] | null,
): T[] {
  if (activeViewSlugs === null) return [...chats];
  const visible = new Set(activeViewSlugs);
  const scoped = chats.filter((chat) => visible.has(chat.slug));
  return scoped.length > 0 ? scoped : [...chats];
}
