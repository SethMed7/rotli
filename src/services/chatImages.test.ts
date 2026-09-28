import { expect, test } from "bun:test";

import { attachedImageUrl, replyMediaRootId } from "./chatImages";

test("a reply's media resolves in the chat's own vault", () => {
  expect(replyMediaRootId("")).toBe("default");
  expect(replyMediaRootId("work:")).toBe("work");
});

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
