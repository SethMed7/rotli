// Align left / center / right for the focused Markdown editor (editor/textAlign.ts).
// Registered from ./actions.ts, kept here so actions.ts stays under its size
// ceiling. No default chords: ⌘⇧L is Secure, and the rest stay free to bind.

import type { TextAlign } from "../editor/alignedLine";
import { activeEditor } from "../editor/commands";
import { EDITOR_ACTION } from "./editorActionIds";
import { notesWorkspaceActive } from "./focusNow";
import { registerAction } from "./registry";

export const ALIGN_ACTIONS: readonly [string, string, TextAlign][] = [
  [EDITOR_ACTION.alignLeft, "Align left", "left"],
  [EDITOR_ACTION.alignCenter, "Align center", "center"],
  [EDITOR_ACTION.alignRight, "Align right", "right"],
];

export function registerAlignActions(): void {
  for (const [id, title, align] of ALIGN_ACTIONS) {
    // shared like the other format commands: the Quick Note window edits Markdown too
    registerAction({
      id,
      title,
      defaultChord: null,
      shared: true,
      run: () => {
        if (notesWorkspaceActive()) activeEditor()?.setAlign?.(align);
      },
    });
  }
}
