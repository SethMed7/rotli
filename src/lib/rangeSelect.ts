// The one ⇧-range rule for every multi-select surface (System browser
// tiles and folders, Captures cards, the Main tree): the inclusive slice of
// the VISIBLE order between the anchor and the clicked item. Each surface
// hands in its own order; none of them re-implement the slice.

/** The inclusive range between `anchorId` and `targetId` in `order`, or null
 * when either is not in the order (the caller then selects the target alone
 * and re-anchors there). Direction does not matter. */
export function rangeBetween<T>(
  order: readonly T[],
  idOf: (item: T) => string,
  anchorId: string,
  targetId: string,
): T[] | null {
  const a = order.findIndex((item) => idOf(item) === anchorId);
  const b = order.findIndex((item) => idOf(item) === targetId);
  if (a < 0 || b < 0) return null;
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
