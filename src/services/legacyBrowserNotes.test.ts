import { describe, expect, test } from "bun:test";

import { BrowserVault, MemoryVaultStore } from "../lib/browserVault";
import { seedReservedRoots } from "./demoCorpus";
import { DEST } from "./destinations";
import { IMPORTED_VAULT_KEY } from "./importedVault";
import { InMemoryNotesService } from "./inMemoryNotes";
import {
  FROM_BROWSER_FOLDER,
  clearLegacyBrowserFiles,
  copyLegacyInto,
  deferLegacyOffer,
  filesFromBrowserSnapshot,
  legacyBrowserFiles,
  legacyFilesToCopy,
  legacyOfferDeferred,
  safeFileName,
} from "./legacyBrowserNotes";
import { MemoryVaultDir } from "./vaultDir";

async function browserSnapshot(): Promise<string> {
  const svc = new InMemoryNotesService();
  seedReservedRoots(svc);
  const ideas = await svc.createFolder("Ideas");
  await svc.createNote(ideas.id, "# Garden plan\n\nTomatoes.\n");
  await svc.createNote(ideas.id, "# Garden plan\n\nA second one.\n");
  const gone = await svc.createNote(ideas.id, "# Thrown away\n\nx\n");
  await svc.trashNote(gone.id);
  return JSON.stringify(svc.exportSnapshot());
}

describe("notes an older Rotli Web kept in the browser", () => {
  test("become files under “From this browser”, in their folders, with Trash left behind", async () => {
    const files = await filesFromBrowserSnapshot(await browserSnapshot());
    expect(files.map((f) => f.path).sort()).toEqual([
      `${FROM_BROWSER_FOLDER}/Ideas/Garden plan (2).md`,
      `${FROM_BROWSER_FOLDER}/Ideas/Garden plan.md`,
    ]);
    expect(files.every((f) => f.note)).toBe(true);
    expect(await filesFromBrowserSnapshot("not json")).toEqual([]);
  });

  test("a title becomes a name every OS accepts", () => {
    expect(safeFileName('a/b:c*?"<>|')).toBe("a b c");
    expect(safeFileName("   ")).toBe("Untitled");
  });

  test("both old stores are read, and cleared only when asked", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await vault.write("notes", await browserSnapshot());
    await vault.write(
      IMPORTED_VAULT_KEY,
      JSON.stringify({
        version: 1,
        name: "v",
        files: { "wiki/a.md": "# A\n" },
        dirs: ["wiki"],
        binaries: { "storage/p.png": "AAEC" },
      }),
    );
    const files = await legacyBrowserFiles(vault);
    expect(files.filter((f) => !f.note).map((f) => f.path)).toEqual(["wiki/a.md", "storage/p.png"]);
    await clearLegacyBrowserFiles(vault);
    expect(await legacyBrowserFiles(vault)).toEqual([]);
  });
});

describe("copying into the connected vault", () => {
  test("writes what is missing, skips what is identical, and never overwrites a difference", async () => {
    const dir = new MemoryVaultDir();
    await dir.mkdir("wiki");
    await dir.writeText("wiki/same.md", "same");
    await dir.writeText("wiki/mine.md", "the vault's own");
    const written = await copyLegacyInto(dir, [
      { path: "wiki/same.md", text: "same", note: false },
      { path: "wiki/mine.md", text: "the browser's", note: false },
      { path: `${FROM_BROWSER_FOLDER}/n.md`, text: "note", note: true },
      { path: "storage/p.png", base64: "AAEC", note: false },
    ]);
    expect(written).toEqual({ written: 3, failed: [] });
    expect(await dir.readText("wiki/mine.md")).toBe("the vault's own");
    expect(await dir.readText("wiki/mine (from this browser).md")).toBe("the browser's");
    // a memex puts browser notes under wiki/
    expect(await dir.readText(`wiki/${FROM_BROWSER_FOLDER}/n.md`)).toBe("note");
    expect([...(await dir.readBytes("storage/p.png"))]).toEqual([0, 1, 2]);
    // a second copy changes nothing
    expect(await copyLegacyInto(dir, [{ path: "wiki/mine.md", text: "the browser's", note: false }])).toEqual(
      {
        written: 0,
        failed: [],
      },
    );
  });

  test("an earlier copy with different text is never overwritten: the next free name is used", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "the vault's");
    await dir.writeText("a (from this browser).md", "an older browser copy");
    expect(await copyLegacyInto(dir, [{ path: "a.md", text: "newest", note: false }])).toEqual({
      written: 1,
      failed: [],
    });
    expect(await dir.readText("a (from this browser).md")).toBe("an older browser copy");
    expect(await dir.readText("a (from this browser 2).md")).toBe("newest");
  });

  test("copying an image again adds nothing: binaries are compared byte for byte", async () => {
    const dir = new MemoryVaultDir();
    const image = { path: "storage/p.png", base64: "AAEC", note: false };
    expect(await copyLegacyInto(dir, [image])).toEqual({ written: 1, failed: [] });
    expect(await copyLegacyInto(dir, [image])).toEqual({ written: 0, failed: [] });
    expect(await dir.exists("storage/p (from this browser).png")).toBe(false);
  });

  test("a file that can't be written is reported, so the browser's copy is not cleared", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki", "a FILE where a folder is needed");
    const result = await copyLegacyInto(dir, [{ path: "wiki/x.md", text: "x", note: false }]);
    expect(result).toEqual({ written: 0, failed: ["wiki/x.md"] });
  });

  test("Trash in the browser stays out of the vault", async () => {
    const files = await filesFromBrowserSnapshot(await browserSnapshot());
    expect(files.some((f) => f.path.includes(DEST.trash))).toBe(false);
  });
});

describe("offering them again", () => {
  test("only what the vault lacks is offered; when it holds everything, the browser's copy is cleared", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await vault.write("notes", await browserSnapshot());
    const dir = new MemoryVaultDir();
    await dir.mkdir("wiki");
    const all = await legacyFilesToCopy(dir, vault);
    expect(all).toHaveLength(2);
    // copy one of the two, as an earlier visit might have
    await copyLegacyInto(dir, [all[0]!]);
    expect((await legacyFilesToCopy(dir, vault)).map((f) => f.path)).toEqual([all[1]!.path]);
    // copy the rest: nothing to offer, and the browser forgets its copy
    await copyLegacyInto(dir, [all[1]!]);
    expect(await legacyFilesToCopy(dir, vault)).toEqual([]);
    expect(await legacyBrowserFiles(vault)).toEqual([]);
  });

  test("Not now is remembered per vault on this browser", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(legacyOfferDeferred(storage, "helper:hv_1")).toBe(false);
    deferLegacyOffer(storage, "helper:hv_1");
    expect(legacyOfferDeferred(storage, "helper:hv_1")).toBe(true);
    expect(legacyOfferDeferred(storage, "folder:other")).toBe(false);
  });
});
