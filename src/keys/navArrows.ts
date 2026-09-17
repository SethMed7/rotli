// ⌘← / ⌘→ beside ⌘[ / ⌘] (the owner, 2026-09-17: "allow for cmd+arrow for
// moving back and forth") — the browser's own Back/Forward chords on a Mac.
// Never inside a text field, where ⌘← is line start: the editor takes the
// chord first, a plain input would not, so the actions stand down there.
// A seam beside actions.ts, which sits at its size ceiling.

import { dispatch, registerAction } from "./registry";

export function registerNavArrowActions(): void {
  registerAction({
    id: "nav.back.arrow",
    title: "Back — previous note (⌘←)",
    defaultChord: "Meta+ArrowLeft",
    unlessEditable: true,
    run: () => dispatch("nav.back"),
  });
  registerAction({
    id: "nav.forward.arrow",
    title: "Forward — next note (⌘→)",
    defaultChord: "Meta+ArrowRight",
    unlessEditable: true,
    run: () => dispatch("nav.forward"),
  });
}
