import { expect, test } from "bun:test";

import { nextAvailableStep, placeStep, TOUR_STEPS } from "./guidedTourModel";

const viewport = { width: 1200, height: 800 };
const card = { width: 300, height: 150 };

test("the card sits below the spotlight when it fits, above when it does not, and never off-screen", () => {
  const below = placeStep({ left: 40, top: 100, width: 120, height: 30 }, viewport, card);
  expect(below.side).toBe("below");
  expect(below.card).toEqual({ left: 34, top: 148 });
  expect(below.ring).toEqual({ left: 34, top: 94, width: 132, height: 42 });
  const above = placeStep({ left: 40, top: 740, width: 120, height: 30 }, viewport, card);
  expect(above.side).toBe("above");
  expect(above.card.top + card.height).toBeLessThanOrEqual(740);
  const edge = placeStep({ left: 1150, top: 100, width: 40, height: 30 }, viewport, card);
  expect(edge.card.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
  // the four scrims tile everything except the ring
  const area = below.scrims.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  expect(area).toBe(viewport.width * viewport.height - below.ring.width * below.ring.height);
});

test("a tall anchor near the top falls to the right side", () => {
  const right = placeStep({ left: 0, top: 0, width: 240, height: 780 }, viewport, card);
  expect(right.side).toBe("right");
  expect(right.card.left).toBe(240 + 6 + 12);
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
