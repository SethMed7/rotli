import { expect, test } from "bun:test";

import { nextAvailableStep, placeStep, spotlightClipPath, TOUR_STEPS } from "./guidedTourModel";

const viewport = { width: 1200, height: 800 };
const card = { width: 300, height: 150 };

test("the card sits below the spotlight when it fits, above when it does not, and never off-screen", () => {
  const below = placeStep({ left: 40, top: 100, width: 120, height: 30 }, viewport, card);
  expect(below.side).toBe("below");
  expect(below.card).toEqual({ left: 38, top: 144 });
  // the hole hugs the control: a 2px breath, not a 6px moat
  expect(below.hole).toEqual({ left: 38, top: 98, width: 124, height: 34 });
  const above = placeStep({ left: 40, top: 740, width: 120, height: 30 }, viewport, card);
  expect(above.side).toBe("above");
  expect(above.card.top + card.height).toBeLessThanOrEqual(740);
  const edge = placeStep({ left: 1150, top: 100, width: 40, height: 30 }, viewport, card);
  expect(edge.card.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
});

test("one scrim covers the viewport with the hole cut out of it", () => {
  const { hole, clipPath } = placeStep({ left: 40, top: 100, width: 120, height: 30 }, viewport, card);
  expect(clipPath).toBe(spotlightClipPath(hole, viewport));
  // outer ring: the viewport corners; inner ring: the hole corners, wound the
  // other way so the cutout survives both nonzero and evenodd filling
  expect(clipPath).toBe(
    "polygon(0px 0px, 1200px 0px, 1200px 800px, 0px 800px, 0px 0px, 38px 98px, 38px 132px, 162px 132px, 162px 98px, 38px 98px)",
  );
  // a hole that spills past the viewport is clamped to it — no negative geometry
  const clamped = spotlightClipPath({ left: -10, top: -10, width: 50, height: 50 }, viewport);
  expect(clamped).toContain("0px 0px, 0px 40px, 40px 40px, 40px 0px");
});

test("a tall anchor near the top falls to the right side", () => {
  const right = placeStep({ left: 0, top: 0, width: 240, height: 780 }, viewport, card);
  expect(right.side).toBe("right");
  expect(right.card.left).toBe(240 + 2 + 12);
});

test("steps skip anchors that are not on screen in either direction", () => {
  const present = (step: { id: string }) => step.id !== "typography" && step.id !== "chat";
  expect(nextAvailableStep(0, 1, present)).toBe(0);
  expect(nextAvailableStep(3, 1, present)).toBe(5);
  expect(nextAvailableStep(4, -1, present)).toBe(2);
  expect(nextAvailableStep(6, 1, present)).toBe(-1);
  expect(TOUR_STEPS.map((step) => step.id)).toEqual([
    "new",
    "views",
    "search",
    "typography",
    "chat",
    "settings",
  ]);
});
