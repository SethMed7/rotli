import { afterEach, expect, test } from "bun:test";

import { canvasDropAt, registerCanvasDrop } from "./canvasDrop";

const realElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
afterEach(() => {
  if (realElementFromPoint) Object.defineProperty(document, "elementFromPoint", realElementFromPoint);
});

/** A plane and something inside it, as `closest` sees them. */
function plane() {
  const el = { closest: () => el } as unknown as HTMLElement;
  const child = { closest: () => el } as unknown as Element;
  return { el, child };
}

test("a note dropped inside a registered canvas reaches it with the drop point", () => {
  const { el, child } = plane();
  document.elementFromPoint = () => child;
  const got: unknown[] = [];
  const stop = registerCanvasDrop(el, (ids, x, y) => got.push([ids, x, y]));
  const hit = canvasDropAt(40, 50);
  expect(hit?.el).toBe(el);
  hit?.drop(["n1", "n2"]);
  expect(got).toEqual([[["n1", "n2"], 40, 50]]);
  // a closed canvas takes nothing
  stop();
  expect(canvasDropAt(40, 50)).toBeNull();
});

test("nothing under the pointer, or no canvas there, is no drop", () => {
  document.elementFromPoint = () => null;
  expect(canvasDropAt(1, 1)).toBeNull();
  document.elementFromPoint = () => ({ closest: () => null }) as unknown as Element;
  expect(canvasDropAt(1, 1)).toBeNull();
});
