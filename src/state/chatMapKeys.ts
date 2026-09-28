// Chat-map keys in settings.json (split out of persist.ts, 2026-09-27, which
// sits at its size ceiling): per-chat choices are keyed `<vault>:<slug>`, and
// these two rules keep that map honest on every read and write.

/** Drop the session-scoped per-chat keys — an unsaved chat's choice (globe,
 * measure) belongs to its pane for this session only, never to settings.json
 * (#7). Shared by the parse (heals a poisoned config) and the snapshot (never
 * writes one again). */
export function persistableChatMap<T>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => k !== "" && !k.startsWith("unsaved:")));
}

/** One-time migration of pre-vault-scoping chat-map keys (2026-08-03): a bare
 * slug re-homes to `<instanceId>:<slug>` when exactly ONE configured instance
 * has that slug. An ambiguous slug (two vaults, same name — the very collision
 * the scoping fixes) or an unknown one is left for the prune to drop; a
 * composite key already claimed keeps its value. Exported for tests. */
export function rescopeChatMapKeys<T>(
  m: Record<string, T>,
  owners: ReadonlyMap<string, readonly string[]>,
): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith("unsaved:") || k.includes(":")) {
      out[k] = v;
      continue;
    }
    const own = owners.get(k);
    if (own?.length === 1) {
      const scoped = `${own[0]}:${k}`;
      if (!(scoped in out) && !(scoped in m)) out[scoped] = v;
    }
    changed = true;
  }
  return changed ? out : m;
}
