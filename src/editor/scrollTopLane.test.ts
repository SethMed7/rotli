import { expect, test } from "bun:test";

import { scrollTopClashes } from "./scrollTopLane";

test("the arrow keeps its corner while the bar leaves the lane free", () => {
  expect(scrollTopClashes(900, 400)).toBe(false);
  expect(scrollTopClashes(532, 400)).toBe(false);
});

test("the arrow rises once the centered bar would reach its corner", () => {
  expect(scrollTopClashes(530, 400)).toBe(true);
  expect(scrollTopClashes(340, 250)).toBe(true);
});

test("no bar, no clash", () => {
  expect(scrollTopClashes(300, 0)).toBe(false);
});

test("with the Librarian pill beside the arrow, the lane is wider and rises sooner", () => {
  expect(scrollTopClashes(900, 400, true)).toBe(false);
  expect(scrollTopClashes(700, 400, true)).toBe(true);
  expect(scrollTopClashes(700, 400, false)).toBe(false);
});

test("in the Quick Note the compact arrow keeps to its corner beside the bar", () => {
  const quick = { closest: (selector: string) => (selector === ".quick-window" ? ({} as Element) : null) };
  const main = { closest: () => null };
  // 100px either side of a 400px bar: the big arrow's 66px lane fits too
  expect(scrollTopClashes(600, 400, false, quick)).toBe(false);
  // 50px either side: the main window's arrow would rise over the text; the
  // Quick Note's 44px lane still fits beside the bar
  expect(scrollTopClashes(500, 400, false, main)).toBe(true);
  expect(scrollTopClashes(500, 400, false, quick)).toBe(false);
  // narrower still, even the compact arrow rises
  expect(scrollTopClashes(480, 400, false, quick)).toBe(true);
});
