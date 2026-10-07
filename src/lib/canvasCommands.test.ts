import { expect, test } from "bun:test";

import { type CanvasCommands, activeCanvas, setActiveCanvas } from "./canvasCommands";

const commands = (): CanvasCommands => ({ newCard() {}, startConnect() {}, group() {}, resize() {} });

test("only the canvas holding focus answers the keys, and only until it lets go", () => {
  const first = commands();
  const second = commands();
  const releaseFirst = setActiveCanvas(first);
  expect(activeCanvas()).toBe(first);
  const releaseSecond = setActiveCanvas(second);
  // the first letting go late never unseats the second
  releaseFirst();
  expect(activeCanvas()).toBe(second);
  releaseSecond();
  expect(activeCanvas()).toBeNull();
});
