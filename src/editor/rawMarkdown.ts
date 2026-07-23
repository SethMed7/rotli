// IDE-like source view for Markdown. Raw mode remains the exact .md text, but
// structure is legible at a glance: Rotli clay marks syntax/punctuation, a
// calm blue carries headings and semantic emphasis, and code/table scaffolding
// gets a restrained monospaced surface. The palette is entirely semantic CSS
// so all four environments — and future user overrides — share one grammar.

import { type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { classifyRawMarkdown } from "./rawMarkdownSyntax";

function build(doc: Text): DecorationSet {
  const classified = classifyRawMarkdown(doc);
  const decorations: Range<Decoration>[] = [
    ...classified.lines.map((line) => Decoration.line({ class: line.className }).range(line.from)),
    ...classified.tokens.map((item) => Decoration.mark({ class: item.className }).range(item.from, item.to)),
  ];
  return Decoration.set(decorations, true);
}

const rawMarkdownField = StateField.define<DecorationSet>({
  create: (state) => build(state.doc),
  update: (value, transaction) => (transaction.docChanged ? build(transaction.state.doc) : value),
  provide: (field) => EditorView.decorations.from(field),
});

export const rawMarkdown = [EditorView.editorAttributes.of({ class: "rotli-raw-mode" }), rawMarkdownField];
