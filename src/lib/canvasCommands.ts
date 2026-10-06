// The keyboard commands of the Canvas that has focus (2026-10-06). The keys
// themselves are remappable actions (keys/canvasActions.ts); they act on the
// one canvas holding focus, which registers itself here. Pure state, no DOM.

export interface CanvasCommands {
  /** Write a card in the middle of the view. */
  newCard: () => void;
  /** Wait for an arrow, then join the selected card to its nearest
   * neighbour that way. */
  startConnect: () => void;
  /** Gather the selected cards into a named group. */
  group: () => void;
  /** Grow or shrink the selected card. */
  resize: (dw: number, dh: number) => void;
}

let active: CanvasCommands | null = null;

/** Make `commands` the focused canvas's until the returned function runs. */
export function setActiveCanvas(commands: CanvasCommands): () => void {
  active = commands;
  return () => {
    if (active === commands) active = null;
  };
}

export function activeCanvas(): CanvasCommands | null {
  return active;
}
