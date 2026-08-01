import { describe, expect, mock, test } from "bun:test";

import type { NoteSummary } from "../types";
import { trashVirtualFolderItems } from "./folderTrash";

const item = (id: string, kind: NoteSummary["kind"]): NoteSummary =>
  ({
    id,
    kind,
    title: id,
    folderId: "Inbox",
    createdAt: 1,
    updatedAt: 1,
  }) as NoteSummary;

describe("virtual-folder trash", () => {
  test("preflights every file and performs no writes when one is read-only", async () => {
    const moveFile = mock(async () => undefined);
    const trashNote = mock(async () => undefined);
    await expect(
      trashVirtualFolderItems([item("note", "note"), item("file", "file")], {
        fileStat: async () => ({ lifecycleMutable: false }),
        moveFile,
        trashNote,
      }),
    ).rejects.toThrow("nothing was moved");
    expect(moveFile).not.toHaveBeenCalled();
    expect(trashNote).not.toHaveBeenCalled();
  });

  test("routes conventional files and note-native items through their owning lanes", async () => {
    const moved: string[] = [];
    await expect(
      trashVirtualFolderItems([item("note", "note"), item("board", "board"), item("file", "file")], {
        fileStat: async () => ({ lifecycleMutable: true }),
        moveFile: async (id) => moved.push(`file:${id}`),
        trashNote: async (id) => moved.push(`note:${id}`),
      }),
    ).resolves.toBe(3);
    expect(moved).toEqual(["note:note", "note:board", "file:file"]);
  });

  test("reports partial progress without hiding independent later attempts", async () => {
    const attempted: string[] = [];
    await expect(
      trashVirtualFolderItems([item("first", "note"), item("second", "note")], {
        fileStat: async () => null,
        moveFile: async () => undefined,
        trashNote: async (id) => {
          attempted.push(id);
          if (id === "first") throw new Error("disk busy");
        },
      }),
    ).rejects.toThrow("1 of 2 items moved; 1 failed (disk busy)");
    expect(attempted).toEqual(["first", "second"]);
  });
});
