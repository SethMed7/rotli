// "Show in Captures" reveal guard (perf audit 2026-07-30, correctness #5).
// One reveal = one (focusedNoteId, revealNonce) pair. The board's reveal
// effect must depend on the derived captures list (a reveal can land before
// the list loads), but any mainTree/quickIds invalidation re-derives that
// list — without this guard every unrelated churn re-fired the effect and
// clobbered an in-progress multi-select back to the focused card.

/** The key to mark handled and fire the reveal for, or null when nothing
 * should fire (no focused capture, or this reveal already ran). */
export function pendingRevealKey(
  handledKey: string | null,
  focusedNoteId: string | null,
  revealNonce: number,
  captureIds: readonly string[],
): string | null {
  if (!focusedNoteId || !captureIds.includes(focusedNoteId)) return null;
  const key = `${focusedNoteId}:${revealNonce}`;
  return handledKey === key ? null : key;
}
