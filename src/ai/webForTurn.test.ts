import { expect, test } from "bun:test";

import { webForTurn } from "./guard";

test("connected models always have the web; the globe is the on-device model's switch", () => {
  expect(webForTurn({ secure: false, onDevice: false, globe: false })).toBe(true);
  expect(webForTurn({ secure: false, onDevice: true, globe: false })).toBe(false);
  expect(webForTurn({ secure: false, onDevice: true, globe: true })).toBe(true);
});

test("secure content keeps the web away from every model", () => {
  expect(webForTurn({ secure: true, onDevice: false, globe: true })).toBe(false);
  expect(webForTurn({ secure: true, onDevice: true, globe: true })).toBe(false);
});
