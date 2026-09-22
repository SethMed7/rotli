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
  filesFromBrowserSnapshot,
  fromBrowserPath,
  legacyBrowserFiles,
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
    expect(fromBrowserPath("wiki/a.md")).toBe("wiki/a (from this browser).md");
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
    expect(written).toBe(3);
    expect(await dir.readText("wiki/mine.md")).toBe("the vault's own");
    expect(await dir.readText("wiki/mine (from this browser).md")).toBe("the browser's");
    // a memex puts browser notes under wiki/
    expect(await dir.readText(`wiki/${FROM_BROWSER_FOLDER}/n.md`)).toBe("note");
    expect([...(await dir.readBytes("storage/p.png"))]).toEqual([0, 1, 2]);
    // a second copy changes nothing
    expect(await copyLegacyInto(dir, [{ path: "wiki/mine.md", text: "the browser's", note: false }])).toBe(0);
  });

  test("Trash in the browser stays out of the vault", async () => {
    const files = await filesFromBrowserSnapshot(await browserSnapshot());
    expect(files.some((f) => f.path.includes(DEST.trash))).toBe(false);
  });
});
