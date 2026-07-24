// The secure-review split (feature B, decision 2026-07-22) — one pure decision
// for what the Activity pane shows. Three lanes, no overlap:
//   · detector-only rows → the confirm lane ("Mark it secure?" — the detector
//     proposes, the user disposes; nothing is ever auto-marked);
//   · flagged rows that are ALSO repair candidates → the repair block owns them;
//   · flagged rows the repair can't take (no stable id, outside intake) → a
//     quiet passive count, still the user's to review by hand.

import type { SecureHint, SecureRepairCandidate } from "../lib/tauri";

export interface SecureReview {
  /** Detector-only notes awaiting the user's Make secure / Not sensitive. */
  confirm: SecureHint[];
  /** Flagged notes neither lane can act on — surfaced as a passive count. */
  flaggedLeftover: number;
}

export function deriveSecureReview(
  hints: SecureHint[],
  repairCandidates: Pick<SecureRepairCandidate, "rel">[],
): SecureReview {
  const repairRels = new Set(repairCandidates.map((c) => c.rel));
  const confirm = hints.filter((h) => !h.flagged);
  const flaggedLeftover = hints.filter((h) => h.flagged && !repairRels.has(h.rel)).length;
  return { confirm, flaggedLeftover };
}
