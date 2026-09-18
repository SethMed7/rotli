/** A copy of `set` with `id` flipped in or out — the one-line body every
 * "toggle this row" updater was writing out by hand. */
export function toggledSet<T>(set: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
