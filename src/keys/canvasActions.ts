// The Canvas's keys (2026-10-06): remappable like every other command, and
// live only while a canvas has focus (development builds). Arrows nudge and
// Delete removes inside the editor itself; these are the rest.

import { activeCanvas } from "../lib/canvasCommands";
import { registerAction } from "./registry";

const RESIZE_STEP = 20;

export function registerCanvasActions(): void {
  const live = () => activeCanvas() !== null;
  const actions: [string, string, string, () => void][] = [
    ["canvas.newCard", "Canvas: write a card", "Enter", () => activeCanvas()?.newCard()],
    [
      "canvas.connect",
      "Canvas: connect to the next card (then an arrow)",
      "C",
      () => activeCanvas()?.startConnect(),
    ],
    ["canvas.group", "Canvas: group the selected cards", "G", () => activeCanvas()?.group()],
    [
      "canvas.wider",
      "Canvas: make the card wider",
      "Alt+Shift+ArrowRight",
      () => activeCanvas()?.resize(RESIZE_STEP, 0),
    ],
    [
      "canvas.narrower",
      "Canvas: make the card narrower",
      "Alt+Shift+ArrowLeft",
      () => activeCanvas()?.resize(-RESIZE_STEP, 0),
    ],
    [
      "canvas.taller",
      "Canvas: make the card taller",
      "Alt+Shift+ArrowDown",
      () => activeCanvas()?.resize(0, RESIZE_STEP),
    ],
    [
      "canvas.shorter",
      "Canvas: make the card shorter",
      "Alt+Shift+ArrowUp",
      () => activeCanvas()?.resize(0, -RESIZE_STEP),
    ],
  ];
  for (const [id, title, defaultChord, run] of actions) {
    registerAction({ id, title, defaultChord, keywords: ["canvas"], enabled: live, run });
  }
}
