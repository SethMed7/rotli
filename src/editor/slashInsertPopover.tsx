// The popover a slash command opens at the cursor: image generation's, or Ask
// AI's. One anchor and one state in CmEditor; the kind picks the body. Also
// where a popover's finished Markdown lands: the list-aware adaptation every
// slash insertion uses, and the caret after it.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { ImageGenState } from "./cmEditorState";
import { ImageGenPopover } from "./imageGenPopover";
import { InlineAiPopover } from "./inlineAiPopover";
import { adaptSlashInsertion } from "./slashMenu";

export function insertAtSlashPoint(
  view: EditorView | null,
  at: number,
  continuation: string,
  markdown: string,
) {
  if (!view) return;
  const clamped = Math.min(at, view.state.doc.length);
  const adapted = adaptSlashInsertion(markdown, markdown.length, continuation);
  view.dispatch({
    changes: { from: clamped, to: clamped, insert: adapted.insert },
    selection: EditorSelection.cursor(clamped + adapted.caret),
  });
  view.focus();
}

export function SlashInsertPopover({
  state,
  noteId,
  view,
  onDone,
  onClose,
}: {
  state: ImageGenState;
  noteId: string;
  view: () => EditorView | null;
  onDone: (markdown: string) => void;
  onClose: () => void;
}) {
  if (state.kind === "ai")
    return <InlineAiPopover state={state} noteId={noteId} view={view} onClose={onClose} />;
  return <ImageGenPopover onDone={onDone} onClose={onClose} />;
}
