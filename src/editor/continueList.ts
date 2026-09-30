// `/Continue a project list` → picker → this (2026-09-29): pick a project's task
// note. Open work left → link it; every task done → start its next note
// ("Round Four" → "Round Five"), linked back to it and filed beside it in Main,
// and link that one instead. Split out of cmEditor.tsx, which sits at its size
// ceiling.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { nextInSeries, nextListBody, openTaskCount } from "../lib/projectList";
import { createLinkedNote } from "../services/linkedNotes";
import { notesService } from "../services/notes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { adaptSlashInsertion } from "./slashMenu";

export function continueListFromPicker(
  view: EditorView,
  picked: NoteSummary,
  picker: { insertAt: number; continuation: string },
  closePicker: (none: null) => void,
): void {
  closePicker(null);
  view.focus();
  void (async () => {
    const note = await notesService.getNote(picked.id);
    if (!note) throw new Error("that note is no longer there");
    const target =
      openTaskCount(note.body) > 0
        ? note
        : await createLinkedNote(nextInSeries(note.title), {
            body: nextListBody(nextInSeries(note.title), note.title),
            besideNoteId: note.id,
          });
    if (!view.dom.isConnected) return;
    const link = `[[${target.title}]]`;
    const at = Math.min(picker.insertAt, view.state.doc.length);
    const { insert, caret } = adaptSlashInsertion(link, link.length, picker.continuation);
    view.dispatch({ changes: { from: at, to: at, insert }, selection: EditorSelection.cursor(at + caret) });
  })().catch((error: unknown) => {
    useUiStore
      .getState()
      .setRowActionError(
        `Couldn’t continue the list — ${error instanceof Error ? error.message : String(error)}`,
      );
  });
}
