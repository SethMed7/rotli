import { expect, test } from "bun:test";

import { attachedImageUrl, refusedDropNotice } from "./chatImages";

test("data, blob, http(s), and asset sources pass through untouched", async () => {
  for (const source of [
    "data:image/png;base64,AA",
    "blob:http://x/1",
    "https://a.b/c.png",
    "asset://localhost/x",
  ]) {
    expect(await attachedImageUrl(source)).toBe(source);
  }
});

test("the refused-drop notice reports what actually landed", () => {
  expect(refusedDropNotice([true, true])).toMatch(/^Saved 2 files to Assets/);
  expect(refusedDropNotice([true, false])).toMatch(/^Saved 1 file to Assets.*1 couldn't be imported\)$/);
  expect(refusedDropNotice([false])).toMatch(/^Nothing was saved/);
});
