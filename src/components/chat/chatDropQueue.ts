// Images dropped on a chat's SIDEBAR ROW (2026-09-17). The drop opens the
// chat, but its composer mounts a moment later, so the paths wait here by
// slug and the composer takes them as it registers (useChatDropTarget). The
// host's one-shot import grants for a drop live 30 s; a queue entry older than
// that would fail to import anyway, so it is dropped instead of retried.

const PENDING_TTL_MS = 25_000;

interface Pending {
  paths: readonly string[];
  at: number;
}

const pending = new Map<string, Pending>();

export function queueChatAttachment(slug: string, paths: readonly string[], now = Date.now()): void {
  if (paths.length === 0) return;
  const prior = pending.get(slug);
  const fresh = prior && now - prior.at <= PENDING_TTL_MS ? prior.paths : [];
  pending.set(slug, { paths: [...fresh, ...paths], at: now });
}

/** The paths waiting for this chat, removed from the queue; null when none
 * or when they are too old for their import grants. */
export function takeChatAttachment(slug: string, now = Date.now()): readonly string[] | null {
  const entry = pending.get(slug);
  if (!entry) return null;
  pending.delete(slug);
  return now - entry.at <= PENDING_TTL_MS ? entry.paths : null;
}
