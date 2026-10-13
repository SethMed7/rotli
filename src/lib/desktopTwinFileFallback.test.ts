import { expect, test } from "bun:test";

import { configureWebVaultIo } from "../services/webVaultIo";
import { PLATFORM } from "./featurePolicy";
import { corpusSetLocked } from "./noteProtection";
import {
  corpusFileBytes,
  corpusFileBytesAi,
  corpusFileStat,
  corpusFileText,
  corpusFileTextAi,
  corpusRawFrontmatter,
  corpusWriteFileBytes,
  fileAssetUrl,
  isTauri,
} from "./tauri";

test("the desktop twin keeps its browser demo file and protection fallbacks without a web vault", async () => {
  expect(PLATFORM).toBe("desktop");
  expect(isTauri()).toBe(false);
  configureWebVaultIo(null, null);
  expect(await fileAssetUrl("storage/example.png")).toBe("");
  expect(await corpusFileText("storage/example.txt")).toBe("");
  expect(await corpusFileBytes("storage/example.png")).toBe("");
  await expect(
    corpusFileTextAi("storage/example.txt", { id: "remote", endpoint: "https://example.com" }),
  ).rejects.toThrow();
  await expect(
    corpusFileBytesAi("storage/example.png", { id: "remote", endpoint: "https://example.com" }),
  ).rejects.toThrow();
  expect(await corpusFileStat("storage/example.txt")).toBeNull();
  expect(await corpusWriteFileBytes("storage/example.txt", btoa("new"), false, "demo-revision")).toBe(
    "demo-revision",
  );
  expect(await corpusRawFrontmatter("demo")).toEqual({ contents: "", revision: "browser" });
  await corpusSetLocked("demo", true);
});
