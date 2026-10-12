import { describe, expect, test } from "bun:test";

import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

describe("web note data integrity", () => {
  test("a note in the secure disk folder keeps secure classification", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/_secure/a.md", "---\nid: protected\n---\nprivate");
    const notes = new FolderNotesService(dir);
    expect((await notes.getNote("protected"))?.secure).toBe(true);
  });

  test("bytes read before an external save never receive that save's revision", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "old");
    const notes = new FolderNotesService(dir);
    await notes.listAll();
    await dir.writeText("a.md", "before");
    const read = dir.readText.bind(dir);
    let changed = false;
    dir.readText = async (path) => {
      const text = await read(path);
      if (path === "a.md" && !changed) {
        changed = true;
        await dir.writeText(path, "external");
      }
      return text;
    };
    const opened = (await notes.getNote("a.md"))!;
    await expect(notes.updateNote("a.md", "mine", opened.revision, opened.body)).rejects.toThrow(
      "revision conflict",
    );
    expect(await read("a.md")).toBe("external");
  });

  test("an external save after the update check is refused by the write gate", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "before");
    const notes = new FolderNotesService(dir);
    const opened = (await notes.getNote("a.md"))!;
    const write = dir.writeText.bind(dir);
    dir.writeText = async (path, text, ...gate) => {
      if (path === "a.md" && text === "mine") await write(path, "external");
      return write(path, text, ...gate);
    };
    await expect(notes.updateNote("a.md", "mine", opened.revision)).rejects.toThrow("revision conflict");
    expect(await dir.readText("a.md")).toBe("external");
  });

  test("an update never returns another writer's revision for its own body", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "before");
    const notes = new FolderNotesService(dir);
    const opened = (await notes.getNote("a.md"))!;
    const write = dir.writeText.bind(dir);
    dir.writeText = async (path, text, gate) => {
      await write(path, text, gate);
      if (path === "a.md" && text === "mine") await write(path, "external");
    };
    await expect(notes.updateNote("a.md", "mine", opened.revision)).rejects.toThrow("revision conflict");
    expect(await dir.readText("a.md")).toBe("external");
  });

  test("a move cannot overwrite a newer body while stamping its origin", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "---\nid: note\n---\nbefore");
    const notes = new FolderNotesService(dir);
    const write = dir.writeText.bind(dir);
    dir.writeText = async (path, text, gate) => {
      if (path === "wiki/a.md" && text.includes("origin:")) await write(path, "---\nid: note\n---\nexternal");
      return write(path, text, gate);
    };
    await expect(notes.trashNote("note")).rejects.toThrow("revision conflict");
    expect(await dir.readText("wiki/a.md")).toContain("external");
    expect(await dir.exists("trash/wiki/a.md")).toBe(false);
  });

  test("restore cannot overwrite a newer body while clearing its origin", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("trash/wiki/a.md", "---\nid: note\norigin: wiki\n---\nbefore");
    await dir.mkdir("wiki");
    const notes = new FolderNotesService(dir);
    const write = dir.writeText.bind(dir);
    dir.writeText = async (path, text, gate) => {
      if (path === "trash/wiki/a.md" && !text.includes("origin:"))
        await write(path, "---\nid: note\norigin: wiki\n---\nexternal");
      return write(path, text, gate);
    };
    await expect(notes.restoreNote("note")).rejects.toThrow("revision conflict");
    expect(await dir.readText("trash/wiki/a.md")).toContain("external");
  });

  for (const action of ["trash", "archive", "restore", "move", "rename"] as const) {
    test(`a secure ${action} protects the destination before moving and removes the old exclusion`, async () => {
      const dir = new MemoryVaultDir();
      await dir.mkdir("wiki/_secure");
      const from = action === "restore" ? "trash/wiki/_secure/a.md" : "wiki/_secure/a.md";
      await dir.writeText(from, "---\nid: protected\nsecure: true\nlocked: true\n---\nwords");
      await dir.writeText(".gitignore", `.rotli/\n${from}\n`);
      const move = dir.move.bind(dir);
      dir.move = async (source, target) => {
        expect((await dir.readText(".gitignore")).split("\n")).toContain(target);
        expect((await dir.readText(".gitignore")).split("\n")).toContain(source);
        await move(source, target);
      };
      const notes = new FolderNotesService(dir);
      if (action === "trash") await notes.trashNote("protected");
      else if (action === "archive") await notes.archiveNote("protected");
      else if (action === "restore") await notes.restoreNote("protected");
      else if (action === "move") await notes.moveNote("protected", "wiki/ideas");
      else await notes.renameFile("protected", "renamed");
      const to = await notes.filePathOf("protected");
      expect((await dir.readText(".gitignore")).split("\n")).toContain(to);
      expect((await dir.readText(".gitignore")).split("\n")).not.toContain(from);
      expect((await notes.getNote("protected"))?.locked).toBe(true);
    });
  }

  test("failure to protect a secure destination aborts relocation", async () => {
    const dir = new MemoryVaultDir();
    await dir.mkdir("wiki");
    await dir.writeText("wiki/a.md", "---\nid: protected\nsecure: true\n---\nwords");
    const write = dir.writeText.bind(dir);
    dir.writeText = async (path, text) => {
      if (path === ".gitignore") throw new Error("gitignore unavailable");
      await write(path, text);
    };
    const notes = new FolderNotesService(dir);
    await expect(notes.trashNote("protected")).rejects.toThrow("gitignore unavailable");
    expect(await dir.exists("wiki/a.md")).toBe(true);
    expect(await dir.exists("trash/wiki/a.md")).toBe(false);
  });

  test("a concurrent gitignore edit is retained while a secure note moves", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/_secure/a.md", "---\nid: protected\nsecure: true\n---\nprivate");
    await dir.writeText(".gitignore", "wiki/_secure/a.md\n");
    const write = dir.writeText.bind(dir);
    let injected = false;
    dir.writeText = async (path, text, gate) => {
      if (path === ".gitignore" && !injected) {
        injected = true;
        await write(path, "wiki/_secure/a.md\nexternal-entry\n");
      }
      return write(path, text, gate);
    };
    const notes = new FolderNotesService(dir);
    await notes.trashNote("protected");
    const exclusions = (await dir.readText(".gitignore")).split("\n");
    expect(exclusions).toContain("external-entry");
    expect(exclusions).toContain("trash/wiki/_secure/a.md");
  });
});
