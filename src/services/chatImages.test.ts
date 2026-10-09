import { expect, test } from "bun:test";

import { currentWebFileStore, registerWebFileStore } from "../lib/webAiSeam";
import { attachedImageSize, attachedImageUrl, replyMediaRootId } from "./chatImages";

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

test("on Rotli Web a sent image still shows after a reload (its vault id resolves)", async () => {
  const before = currentWebFileStore();
  registerWebFileStore({
    createImageAsset: async () => "",
    imageUrl: async (rel) => `blob:web/${rel}`,
    fileExists: async () => true,
  });
  try {
    expect(await attachedImageUrl("storage/images/shot.png")).toBe("blob:web/storage/images/shot.png");
    expect(await attachedImageUrl("work:storage/images/shot.png")).toBe("blob:web/storage/images/shot.png");
  } finally {
    registerWebFileStore(before);
  }
});

test("an attached image's size: a data URL measures its bytes; a vault id the Mac app stats", async () => {
  // 8 base64 chars = 6 bytes; "=" padding drops one each
  expect(await attachedImageSize("data:image/png;base64,QUJDREVG")).toBe(6);
  expect(await attachedImageSize("data:image/png;base64,QUJDRA==")).toBe(4);
  // outside the Mac app there is no stat: no size, never a guess
  expect(await attachedImageSize("storage/images/shot.png")).toBeNull();
});
