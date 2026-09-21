// `/template` → picker → this: read the chosen template's body and insert it
// where the slash was typed. The read is async, so the picker closes first and
// the text lands when it arrives (the attach-image shape in cmEditor.tsx).
// Split out of cmEditor.tsx, which sits at its size ceiling.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { notesService } from "../services/notes";
import { isPresetTemplate, presetTemplateBody } from "../services/templates";
import { useUiStore } from "../state/ui";
import { templateInsertion } from "./slashActions";
import { adaptSlashInsertion } from "./slashMenu";

export function insertTemplateFromPicker(
  view: EditorView,
  templateId: string,
  picker: { insertAt: number; continuation: string },
  closePicker: (none: null) => void,
): void {
  closePicker(null);
  view.focus();
  // a built-in preset is Rotli's own text, not a note in the vault
  const read = isPresetTemplate(templateId)
    ? Promise.resolve(presetTemplateBody(templateId)).then((body) => (body === null ? null : { body }))
    : notesService.getNote(templateId);
  void read
    .then((template) => {
      if (!template) throw new Error("that template is no longer there");
      if (!view.dom.isConnected) return;
      // the slash text is already gone: a note with nothing else in it is EMPTY,
      // and only then does the template's own heading come along as the title
      const hostIsEmpty = view.state.doc.toString().trim() === "";
      const text = templateInsertion(template.body, hostIsEmpty);
      if (!text) return;
      const at = Math.min(picker.insertAt, view.state.doc.length);
      const { insert, caret } = adaptSlashInsertion(text, text.length, picker.continuation);
      view.dispatch({ changes: { from: at, to: at, insert }, selection: EditorSelection.cursor(at + caret) });
    })
    .catch((error: unknown) => {
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t insert the template — ${error instanceof Error ? error.message : String(error)}`,
        );
    });
}
