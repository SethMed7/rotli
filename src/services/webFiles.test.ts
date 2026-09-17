import { describe, expect, test } from "bun:test";

import { BrowserVault, MemoryVaultStore } from "../lib/browserVault";
import { MemoryVaultDir } from "./vaultDir";
import { ASSET_FOLDER, createWebFileStore, freeName, safeAssetName } from "./webFiles";

// a 1×1 PNG, the smallest real image bytes a drop can carry
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const kv = () => new BrowserVault(new MemoryVaultStore());

describe("where a dropped image lands", () => {
  test("the app's one folder for every vault, and the app's name rule on a clash", () => {
    expect(ASSET_FOLDER).toBe("storage/images");
    expect(safeAssetName("/Users/x/Screenshot 1.png")).toBe("Screenshot 1.png");
    expect(safeAssetName("..\\..\\evil.png")).toBe("evil.png");
    expect(safeAssetName(".hidden.png")).toBe("hidden.png");
    // `a-2.png`, never `a (2).png`: the Markdown image link cannot hold a `)`
    const taken = new Set(["a.png", "a-2.png"]);
    expect(freeName("a.png", (n) => taken.has(n))).toBe("a-3.png");
    expect(freeName("b.png", (n) => taken.has(n))).toBe("b.png");
  });
});

describe("folder mode (a connected or imported folder)", () => {
  test("writes the real file beside the notes and returns the app's storage id", async () => {
    const dir = new MemoryVaultDir();
    const store = createWebFileStore(dir, kv);
    const id = await store.createImageAsset("default", "shot.png", PNG_BASE64);
    expect(id).toBe("storage/images/shot.png");
    expect(await dir.exists("storage/images/shot.png")).toBe(true);
    expect((await dir.readBytes("storage/images/shot.png")).byteLength).toBe(70);
    // the same name again does not overwrite, nor does a case-only twin (a
    // case-insensitive disk would silently replace the Mac's file)
    expect(await store.createImageAsset("default", "shot.png", PNG_BASE64)).toBe("storage/images/shot-2.png");
    expect(await store.createImageAsset("default", "SHOT.PNG", PNG_BASE64)).toBe("storage/images/SHOT-3.PNG");
  });

  test("two drops in flight at once still get two files", async () => {
    const dir = new MemoryVaultDir();
    const store = createWebFileStore(dir, kv);
    const ids = await Promise.all([
      store.createImageAsset("default", "shot.png", PNG_BASE64),
      store.createImageAsset("default", "shot.png", PNG_BASE64),
    ]);
    expect(ids.sort()).toEqual(["storage/images/shot-2.png", "storage/images/shot.png"]);
  });

  test("serves the stored bytes as an image URL, and a missing file as nothing", async () => {
    const dir = new MemoryVaultDir();
    const store = createWebFileStore(dir, kv);
    const id = await store.createImageAsset("default", "shot.png", PNG_BASE64);
    expect((await store.imageUrl(id)).startsWith("blob:")).toBe(true);
    // a legacy vault's `Storage/` file still answers its `storage:` link, as on the Mac's disk
    await dir.writeBytes("Storage/old.png", new Uint8Array([1]));
    expect((await store.imageUrl("storage/old.png")).startsWith("blob:")).toBe(true);
    expect(await store.imageUrl("storage/nope.png")).toBe("");
  });

  test("refuses non-image names and oversized bytes without writing", async () => {
    const dir = new MemoryVaultDir();
    const store = createWebFileStore(dir, kv);
    await expect(store.createImageAsset("default", "notes.md", PNG_BASE64)).rejects.toThrow(
      /images must use/,
    );
    // refused on the encoded length, before any decoding
    const huge = "A".repeat(Math.ceil((25_000_000 * 4) / 3) + 12);
    await expect(store.createImageAsset("default", "big.png", huge)).rejects.toThrow(/25 MB/);
    expect(await dir.list("")).toEqual([]);
  });
});

describe("browser storage mode", () => {
  test("keeps the image in the browser vault under its vault path and serves it back", async () => {
    const vault = kv();
    const store = createWebFileStore(null, () => vault);
    const id = await store.createImageAsset("default", "shot.png", PNG_BASE64);
    expect(id).toBe("storage/images/shot.png");
    expect(await vault.read("asset:storage/images/shot.png")).toBe(PNG_BASE64);
    expect(await store.createImageAsset("default", "shot.png", PNG_BASE64)).toBe("storage/images/shot-2.png");
    expect((await store.imageUrl(id)).startsWith("blob:")).toBe(true);
    expect(await store.imageUrl("storage/images/other.png")).toBe("");
  });
});
