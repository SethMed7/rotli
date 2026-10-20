// Chat-map keys in settings.json (split out of persist.ts, 2026-09-27, which
// sits at its size ceiling): per-chat choices are keyed `<vault>:<slug>`, and
// these rules keep that map honest on every read and write.

declare const chatKeyBrand: unique symbol;
/** A per-chat map key. Compile-time only — on disk it is the same plain string —
 * so a raw string (an empty id, a bare tab id) cannot index a per-chat map. */
export type ChatKey = string & { readonly [chatKeyBrand]: true };
/** Every per-chat preference map (model, reasoning, tier, globe, measure). */
export type ChatMap<T> = Record<ChatKey, T>;

const UNSAVED = "unsaved:";

/** The one constructor: refuses "" (the legacy shared key that leaked one
 * chat's choice into every future fresh chat, #7); any other string — a
 * composite, a legacy bare slug, or an `unsaved:<tabId>` session key — passes. */
export function toChatKey(raw: string): ChatKey | null {
  return raw === "" ? null : (raw as ChatKey);
}

/** A session-scoped key: belongs to its pane for this session, never to disk. */
export function isUnsavedChatKey(key: string): boolean {
  return key.startsWith(UNSAVED);
}

/** The per-chat key: `<instanceId>:<slug>` for a saved chat, or a TAB-scoped
 * session key while the chat is still unsaved. VAULT-scoped since 2026-08-03:
 * a bare slug collided across brains sharing one corpus settings.json. */
export function chatKey(instanceId: string | null, slug: string | null, tabId: string): ChatKey {
  const raw = !slug ? `${UNSAVED}${tabId}` : instanceId ? `${instanceId}:${slug}` : slug;
  return raw as ChatKey; // never "": both forms are non-empty by construction
}

/** Keep only the keys that may live in settings.json — an unsaved chat's choice
 * (globe, measure) belongs to its pane for this session only (#7). Shared by the
 * parse (heals a poisoned config) and the snapshot (never writes one again). */
export function persistableChatMap<T>(m: Record<string, T>): ChatMap<T> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => toChatKey(k) !== null && !isUnsavedChatKey(k)));
}

/** One-time migration of pre-vault-scoping chat-map keys (2026-08-03): a bare
 * slug re-homes to `<instanceId>:<slug>` when exactly ONE configured instance
 * has that slug. An ambiguous slug (two vaults, same name — the very collision
 * the scoping fixes) or an unknown one is left for the prune to drop; a
 * composite key already claimed keeps its value. Exported for tests. */
export function rescopeChatMapKeys<T>(
  m: ChatMap<T>,
  owners: ReadonlyMap<string, readonly string[]>,
): ChatMap<T> {
  let changed = false;
  const out: ChatMap<T> = {};
  for (const [k, v] of Object.entries(m) as [ChatKey, T][]) {
    if (isUnsavedChatKey(k) || k.includes(":")) {
      out[k] = v;
      continue;
    }
    const own = owners.get(k);
    if (own?.length === 1) {
      const scoped = toChatKey(`${own[0]}:${k}`);
      if (scoped && !(scoped in out) && !(scoped in m)) out[scoped] = v;
    }
    changed = true;
  }
  return changed ? out : m;
}

/** Each listed chat's pinned model by slug — its vault-scoped key, else a legacy
 * bare-slug key (the dashboard's model mix). */
export function chatModelsBySlug(
  chats: readonly { slug: string }[],
  instanceId: string | null,
  models: ChatMap<string>,
): Record<string, string> {
  return Object.fromEntries(
    chats.flatMap((chat) => {
      const id = models[chatKey(instanceId, chat.slug, "")] ?? models[chatKey(null, chat.slug, "")];
      return id ? [[chat.slug, id]] : [];
    }),
  );
}
