/** v clamped into [lo, hi] — the one definition (remediation Batch 3; 8 surfaces
 * used to retype it with the min/max order flipped per taste). lo > hi is a
 * caller bug; the hi bound wins, matching Math.min-outermost retypings. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
