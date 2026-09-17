import { expect, test } from "bun:test";

import { attachedImageUrl } from "./chatImages";

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
