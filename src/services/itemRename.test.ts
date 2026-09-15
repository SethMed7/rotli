import { describe, expect, test } from "bun:test";

import { fileNameStem, userFileName as renamedFileName } from "../lib/fileKind";
import { renameFileItem, renameLane, type FileRenamePorts } from "./itemRename";

describe("which items can be renamed, and how", () => {
  test("notes rename their title, boards and documents/sheets their file", () => {
    expect(renameLane({ id: "01NOTE", kind: "note" })).toBe("title");
    expect(renameLane({ id: "01LEGACY" })).toBe("title");
    expect(renameLane({ id: "storage/excalidraw/sketch.excalidraw", kind: "board" })).toBe("board");
    expect(renameLane({ id: "storage/rotli/untitled-1.docx", kind: "file" })).toBe("file");
    expect(renameLane({ id: "vault:storage/rotli/Budget.XLSX", kind: "file" })).toBe("file");
  });

  test("files Rotli cannot name stay without a Rename", () => {
    expect(renameLane({ id: "storage/photo.png", kind: "file" })).toBeNull();
    expect(renameLane({ id: "storage/reference.pdf", kind: "file" })).toBeNull();
    expect(renameLane({ id: "storage/legacy.doc", kind: "file" })).toBeNull();
  });

  test("the rename field is seeded with the name, never the extension", () => {
    expect(fileNameStem("storage/rotli/Quarterly plan.docx")).toBe("Quarterly plan");
    expect(fileNameStem("vault:storage/rotli/a.b.xlsx")).toBe("a.b");
  });

  test("the browser twin mirrors the Rust filename rule", () => {
    expect(renamedFileName("Plan", "docx")).toBe("Plan.docx");
    expect(renamedFileName(" Plan.DOCX ", "docx")).toBe("Plan.docx");
    expect(renamedFileName("a/b", "docx")).toBe("a-b.docx");
    expect(() => renamedFileName("  ", "docx")).toThrow("needs a name");
    expect(() => renamedFileName(".hidden", "docx")).toThrow();
  });
});

function fakePorts(calls: string[], overrides: Partial<FileRenamePorts> = {}): FileRenamePorts {
  return {
    flushDocuments: async () => {
      calls.push("flush");
    },
    rename: async (id, name) => {
      calls.push(`rename ${id} → ${name}`);
      return `storage/rotli/${name}.docx`;
    },
    retarget: (oldId, newId) => calls.push(`retarget ${oldId} → ${newId}`),
    renameReferences: (oldId, newId) => calls.push(`refs ${oldId} → ${newId}`),
    refresh: async () => {
      calls.push("refresh");
    },
    ...overrides,
  };
}

describe("renaming a document", () => {
  test("saves the open document first, then moves tabs and Main/view references", async () => {
    const calls: string[] = [];
    const id = await renameFileItem(fakePorts(calls), "storage/rotli/untitled-1.docx", "  Plan ");
    expect(id).toBe("storage/rotli/Plan.docx");
    expect(calls).toEqual([
      "flush",
      "rename storage/rotli/untitled-1.docx → Plan",
      "retarget storage/rotli/untitled-1.docx → storage/rotli/Plan.docx",
      "refs storage/rotli/untitled-1.docx → storage/rotli/Plan.docx",
      "refresh",
    ]);
  });

  test("a blank or unchanged name does nothing", async () => {
    const calls: string[] = [];
    expect(await renameFileItem(fakePorts(calls), "storage/rotli/Plan.docx", "   ")).toBeNull();
    expect(await renameFileItem(fakePorts(calls), "storage/rotli/Plan.docx", "Plan")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a refused rename leaves tabs and references pointing at the file", async () => {
    const calls: string[] = [];
    const ports = fakePorts(calls, {
      rename: async () => {
        throw new Error("a file named “Plan.docx” already exists here");
      },
    });
    await expect(renameFileItem(ports, "storage/rotli/Draft.docx", "Plan")).rejects.toThrow("already exists");
    expect(calls).toEqual(["flush"]);
  });

  test("an unsaved document that cannot be saved is not renamed", async () => {
    const calls: string[] = [];
    const ports = fakePorts(calls, {
      flushDocuments: async () => {
        throw new Error("disk full");
      },
    });
    await expect(renameFileItem(ports, "storage/rotli/Draft.docx", "Plan")).rejects.toThrow("disk full");
    expect(calls).toEqual([]);
  });
});
