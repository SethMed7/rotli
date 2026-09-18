// Open-at-a-line (the owner, 2026-09-18: a task in the Tasks list should land
// you ON that task, not at the top of its note). The caller opens the note the
// ordinary way, then asks for the jump; this waits for the note's editor to
// mount, finds the line, and puts the caret there, centred.
//
// It lives beside cmEditor.tsx rather than in it (that file is at its size
// ceiling) and reaches the view through CodeMirror's own DOM lookup. The line
// is VERIFIED against the task's words before anything moves: while the pane
// still shows the previous note, or if the note changed since the list was
// built, the index alone would land somewhere arbitrary.

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { resolveLine } from "./resolveLine";

const GIVE_UP_AFTER_MS = 2_000;

/** After opening a note: put the caret at the end of the line holding `words`
 * (expected at 0-based body `line`) once its editor is up. Quietly gives up. */
export function jumpToLineWhenOpen(line: number, words: string): void {
  const started = performance.now();
  const attempt = () => {
    for (const dom of document.querySelectorAll<HTMLElement>(".rotli-cm-host .cm-editor")) {
      const view = EditorView.findFromDOM(dom);
      if (!view) continue;
      const at = resolveLine(view.state.doc.toString().split("\n"), line, words);
      if (at === -1) continue;
      const target = view.state.doc.line(at + 1);
      view.dispatch({
        selection: EditorSelection.cursor(target.to),
        effects: EditorView.scrollIntoView(target.from, { y: "center" }),
      });
      view.focus();
      return;
    }
    if (performance.now() - started < GIVE_UP_AFTER_MS) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
