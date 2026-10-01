// An AI's edit to a Word document, one path for every AI: the chat's
// edit_document and an outside agent's rotli_apply_document (the agent
// bridge). Parse the actions, refuse a document open in a pane (it saves on
// its own), apply them to the document as read, and save through the AI's
// write lane, where Rust refuses a person's document and secret-shaped text.

import { applyDocumentEdits, type DocumentEditAction, parseEditAction } from "../documents/aiEdit";
import type { EditableDocument } from "../documents/model";
import { documentIsOpen } from "../documents/session";

export type AiDocumentEdit =
  | { kind: "saved"; document: EditableDocument; revision: string; count: number }
  | { kind: "refused"; reason: string };

export async function editDocumentAsAi(
  file: { id: string; title: string },
  rawActions: unknown[],
  /** An outside agent's revision from its read: a newer file is refused. */
  expectedRevision?: string,
): Promise<AiDocumentEdit> {
  const refused = (reason: string): AiDocumentEdit => ({ kind: "refused", reason });
  const actions: DocumentEditAction[] = [];
  for (const [index, raw] of rawActions.entries()) {
    const action = parseEditAction(raw);
    if (typeof action === "string") return refused(`error: action ${index + 1}: ${action}`);
    actions.push(action);
  }
  if (documentIsOpen(file.id)) {
    return refused(`blocked: "${file.title}" is open in a pane. Ask the user to close it, then try again.`);
  }
  const { editAiDocument } = await import("../documents/composition");
  const editable = await editAiDocument(file.id);
  if (editable.kind !== "ready") return refused("error: this document is too large for Rotli to edit.");
  if (expectedRevision !== undefined && editable.revision !== expectedRevision) {
    return refused("error: the document changed since it was read. Read it again, then edit.");
  }
  const next = applyDocumentEdits(editable.document, actions);
  if (typeof next === "string") return refused(`error: ${next}. Nothing was changed.`);
  try {
    // Rust refuses a document a person made, and secret-shaped text
    const revision = await editable.save(next);
    return { kind: "saved", document: next, revision, count: actions.length };
  } catch (error) {
    return refused(`blocked: ${error instanceof Error ? error.message : String(error)}`);
  }
}
