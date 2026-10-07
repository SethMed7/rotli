import { expect, test } from "bun:test";

import { MAX_ZOOM, fitView, hitTest, nextInDirection, toGraph, toScreen, zoomAt } from "./viewport";

test("screen and graph coordinates round-trip, and zoom keeps the point under the pointer", () => {
  const view = { x: 30, y: -20, k: 1.5 };
  const [sx, sy] = toScreen(view, 800, 600, 12, -7);
  expect(toGraph(view, 800, 600, sx, sy)).toEqual([12, -7]);
  const zoomed = zoomAt(view, 800, 600, sx, sy, 2);
  const [gx, gy] = toGraph(zoomed, 800, 600, sx, sy);
  expect(gx).toBeCloseTo(12);
  expect(gy).toBeCloseTo(-7);
  expect(zoomAt(view, 800, 600, 0, 0, 1000).k).toBe(MAX_ZOOM);
});

test("fit frames every dot with padding and never zooms a tiny graph in close", () => {
  const view = fitView(
    [
      { id: "a", x: -100, y: 0, r: 5 },
      { id: "b", x: 100, y: 50, r: 5 },
    ],
    200,
    300,
    20,
  );
  // the 210-unit-wide drawing fits 160 px of width
  expect(view.k).toBeCloseTo(160 / 210);
  expect(view.x).toBeCloseTo(0);
  expect(fitView([{ id: "a", x: 0, y: 0, r: 4 }], 800, 600).k).toBe(1.4);
  expect(fitView([], 800, 600)).toEqual({ x: 0, y: 0, k: 1 });
});

test("hit tests forgive a few units and pick the nearest dot", () => {
  const points = [
    { id: "a", x: 0, y: 0, r: 3 },
    { id: "b", x: 8, y: 0, r: 3 },
  ];
  expect(hitTest(points, 5, 0, 4)).toBe("b");
  expect(hitTest(points, 0, 20, 4)).toBeNull();
});

test("arrow travel goes to the nearest dot roughly that way", () => {
  const points = [
    { id: "c", x: 0, y: 0, r: 3 },
    { id: "right", x: 50, y: 5, r: 3 },
    { id: "farRight", x: 120, y: 0, r: 3 },
    { id: "up", x: 0, y: -40, r: 3 },
  ];
  expect(nextInDirection(points, "c", "right")).toBe("right");
  expect(nextInDirection(points, "c", "up")).toBe("up");
  expect(nextInDirection(points, "c", "left")).toBeNull();
  expect(nextInDirection(points, "missing", "up")).toBeNull();
});
