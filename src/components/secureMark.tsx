// The quiet "Secure note" mark on a note's row (the owner, 2026-11-24: "some
// sort of badge … so I notice at a glance that it is secure but also nothing
// that will get in my way"). A small shield in the muted ink, the same
// glyph Quick Note's secure control and the Graph use — the padlock stays for
// LOCKED, which is a different promise. It reads one flag the list already
// carries (NoteSummary.secure), so it costs no read per row and says nothing a
// row did not already know.

import type { NoteSummary } from "../types";
import { ShieldGlyph } from "./glyphs";

export const SECURE_MARK_LABEL = "Secure note";

/** Strict on purpose: a summary without the flag is not marked. */
export const isMarkedSecure = (note: Pick<NoteSummary, "secure">): boolean => note.secure === true;

export function SecureMark({ className }: { className?: string }) {
  return (
    <span
      className={className ? `secure-mark ${className}` : "secure-mark"}
      role="img"
      aria-label={SECURE_MARK_LABEL}
      title={SECURE_MARK_LABEL}
    >
      <ShieldGlyph size={12} />
    </span>
  );
}
