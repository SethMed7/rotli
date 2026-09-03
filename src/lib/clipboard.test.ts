// Outside Tauri (bun test, the browser twin) the pasteboard adapter is a
// declared no-op: a copy still carries text/html from the event itself, and
// an image that cannot be inlined copies as its name rather than failing.
import { describe, expect, test } from "bun:test";

import { corpusImageDataUrl, writeClipboardHtml } from "./clipboard";

describe("clipboard adapter outside Tauri", () => {
  test("writing HTML resolves without touching a pasteboard", async () => {
    await expect(writeClipboardHtml("<p>x</p>", "x")).resolves.toBeUndefined();
  });

  test("an image data URL is empty, never a rejection, for storage: and relative sources", async () => {
    expect(await corpusImageDataUrl("default", "storage:a.png")).toBe("");
    expect(await corpusImageDataUrl("vault", "assets/b.jpg")).toBe("");
  });
});
