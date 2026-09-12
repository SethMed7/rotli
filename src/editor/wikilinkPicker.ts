// The `[[` picker: while a wikilink target is typed, list matching notes;
// picking one writes `[[title]]` (or the id when titles collide) and closes it.

import type { NoteSummary } from "../types";
import { createCaretPicker } from "./caretPicker";
import { buildTitleCounts, wikilinkLabel } from "./wikilink";
import { wikilinkNotes } from "./wikilinkIndex";
import { wikilinkChoices, wikilinkPickAt } from "./wikilinkPickState";

export const wikilinkPicker = createCaretPicker<NoteSummary>({
  className: "rotli-linkpick",
  label: "Link a note",
  detect(state) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const span = wikilinkPickAt(line.text, head - line.from);
    if (!span) return null;
    return {
      from: line.from + span.open,
      to: line.from + span.to,
      anchor: line.from + span.open,
      query: span.query,
      choices: wikilinkChoices(wikilinkNotes(), span.query),
    };
  },
  insert: (note) => `[[${wikilinkLabel(note, buildTitleCounts(wikilinkNotes()))}]]`,
  row(node, note) {
    const title = document.createElement("span");
    title.className = "rotli-linkpick-title";
    title.textContent = note.title;
    const hint = document.createElement("span");
    hint.className = "rotli-linkpick-hint";
    hint.textContent = note.id.split("/").pop() ?? note.id;
    node.append(title, hint);
  },
});
