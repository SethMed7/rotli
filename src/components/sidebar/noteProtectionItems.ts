// The note menu's protection controls: lock, who may edit the text, secure,
// and on-device access (split out of useNoteMenu.ts, 2026-09-29). Each item
// writes one Rotli-owned frontmatter line; Rust owns every verdict, and the
// menu only reflects the view it read.

import type { AiBodyEdit } from "../../lib/aiEditPolicy";
import {
  corpusSetAiEdit,
  corpusSetLocalAiAccess,
  corpusSetLocked,
  corpusSetSecure,
} from "../../lib/noteProtection";
import type { MenuSpec } from "../../state/contextMenu";

/** The slice of the note's frontmatter view these items read. */
interface ProtectionView {
  locked: boolean;
  secure: boolean;
  localAiAllowed: boolean;
  aiBodyEdit: AiBodyEdit;
}

export function noteProtectionItems(
  noteId: string,
  fm: ProtectionView | null,
  secureAtHome: boolean,
  runFm: (verb: string, op: Promise<unknown>) => void,
): MenuSpec[] {
  const items: MenuSpec[] = [];
  items.push({
    kind: "action" as const,
    // LOCKED is an EDIT control — every model still READS a locked note
    // (the maintainer, 2026-08-01; docs/design/ai-visibility-matrix.md)
    label: fm?.locked ? "Unlock — AI may file and tag it again" : "Lock — no AI may edit or file it",
    checked: !!fm?.locked,
    // protection states wear the LOCK, not the star (the maintainer, 2026-07-29)
    checkedMark: "lock" as const,
    onClick: () => runFm("lock", corpusSetLocked(noteId, !fm?.locked)),
  });
  if (fm && !fm.locked) {
    // WHO MAY REWRITE THE TEXT (2026-09-29): a note a person wrote is
    // closed to AI edits until they turn this on; a note a chat, an
    // agent, or the Librarian made starts open. Rust owns the verdict.
    const aiMayEdit = fm.aiBodyEdit === "allowed";
    items.push({
      kind: "action" as const,
      label: "Let AI edit the text",
      checked: aiMayEdit,
      onClick: () => runFm("change AI editing", corpusSetAiEdit(noteId, !aiMayEdit)),
    });
  }
  items.push({
    kind: "action" as const,
    label: fm?.secure ? "Remove secure protection" : "Mark secure — block remote AI",
    checked: !!fm?.secure,
    checkedMark: "lock" as const,
    onClick: () => runFm("mark secure", corpusSetSecure(noteId, !fm?.secure)),
  });
  if (fm?.secure && !secureAtHome) {
    items.push({
      kind: "action" as const,
      label: "Move into Library › Secure notes",
      onClick: () => runFm("move to Secure notes", corpusSetSecure(noteId, true)),
    });
  }
  if (fm?.secure) {
    // `localAiAllowed` is the EFFECTIVE verdict Rust resolved (note
    // override → the vault knob → allow). On-device access is the
    // default since 2026-08-01, so the common verb here is now HIDE.
    items.push({
      kind: "action" as const,
      label: fm.localAiAllowed ? "Hide from on-device AI too" : "Let on-device AI read it",
      checked: fm.localAiAllowed,
      onClick: () => runFm("change Local AI access", corpusSetLocalAiAccess(noteId, !fm.localAiAllowed)),
    });
  }
  return items;
}
