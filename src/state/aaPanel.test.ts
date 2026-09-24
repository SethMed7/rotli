import { expect, test } from "bun:test";

import { aaRequestStep } from "./aaPanel";

const request = { paneId: "p1", nonce: 3 };

test("a new request for this pane toggles once its Aa chip is there", () => {
  expect(aaRequestStep(request, 2, "p1", true)).toBe("toggle");
});

test("a press while the note is still loading waits for the chip instead of being lost", () => {
  expect(aaRequestStep(request, 2, "p1", false)).toBe("wait");
  // …and toggles once the chip mounts
  expect(aaRequestStep(request, 2, "p1", true)).toBe("toggle");
});

test("another pane's request is marked seen; an old one is ignored", () => {
  expect(aaRequestStep(request, 2, "p2", true)).toBe("consume");
  expect(aaRequestStep(request, 3, "p1", true)).toBe("ignore");
  expect(aaRequestStep(null, 0, "p1", true)).toBe("ignore");
});
