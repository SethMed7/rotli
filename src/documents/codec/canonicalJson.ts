// Comparing two document values as data, not as serialized text.

/** JSON with object keys sorted. The decoder and the editor build the same
 * run style with keys in different orders, and that must not read as an edit:
 * a false "changed" sends an untouched paragraph down the rewrite path, which
 * refuses unsupported inline content and blocks the whole save. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}
