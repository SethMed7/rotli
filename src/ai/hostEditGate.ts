// The gate every chat change to an existing note passes before its write lane
// (split out of host.ts, 2026-11-24, when tag_note joined update_note). Rust
// enforces the lane again; this is the host's own refusal, with the person's
// "Allow once" question for a note they wrote.

import { corpusSetAiEdit } from "../lib/noteProtection";
import { externalText, fixed, type PromptText, prompt } from "../lib/promptText";
import { type ChatModelInfo, corpusFrontmatter } from "../lib/tauri";
import { approvedNote } from "./approvedRead";
import { askToEdit, type EditAnswer, type EditRequest, UNREADABLE_PROTECTION } from "./editGate";
import { assertAiNoteLocation } from "./hostReadGate";

const errorText = (e: unknown) => externalText(e instanceof Error ? e.message : String(e));

export interface EditGateOptions {
  confirmEdit?: (request: EditRequest) => Promise<EditAnswer>;
  onSecureNoteRead?: () => void;
  isSecureContext?: () => boolean;
}

export function makeEditGate(model: ChatModelInfo, opts: EditGateOptions | undefined) {
  /** The checks every AI change to an existing note passes before its write
   * lane (which Rust enforces again): the same read gate every AI read passes
   * (Rust's corpus_read_ai refuses secure notes to remote models and
   * knob-denied local ones), then ONE frontmatter read for the lock, the
   * person's grant (a person's note asks them first, ai/editGate.ts), the
   * secure taint, and the secure-context rule. Unknowable = secure AND locked.
   * Answers the revision to write against, or the refusal for the model. */
  return async (id: string): Promise<{ revision: string; consented: boolean } | PromptText> => {
    let readRevision: string;
    let readTitle = "this note";
    let protectedLocation: boolean;
    try {
      protectedLocation = await assertAiNoteLocation(id, model);
      const read = await approvedNote(id, model);
      readRevision = read.revision;
      readTitle = read.title || readTitle;
    } catch (e) {
      return prompt`blocked: ${errorText(e)}`;
    }
    const frontmatter = await corpusFrontmatter(id).catch(() => null);
    const gate = await askToEdit(frontmatter, { id, title: readTitle }, opts?.confirmEdit, (note) =>
      corpusSetAiEdit(note, true),
    );
    if (gate.block || !frontmatter) return prompt`${externalText(gate.block ?? UNREADABLE_PROTECTION)}`;
    if (opts?.onSecureNoteRead && (frontmatter.secure === true || protectedLocation)) {
      opts.onSecureNoteRead();
    }
    // the create_note taint law's edit twin (PR #4 P1): a chat carrying
    // secure-note content may only change notes that are THEMSELVES secure
    if (opts?.isSecureContext?.() === true && frontmatter.secure !== true && !protectedLocation) {
      return fixed(
        "blocked: this chat carries secure-note content, so it can only edit notes that are themselves secure. Use create_note instead — the new note will be marked secure.",
      );
    }
    return { revision: readRevision, consented: gate.consented };
  };
}
