import { describe, expect, test } from "bun:test";

import { usePanesStore } from "../state/panes";
import { DEST } from "./destinations";
import { noteImageRels, referencedElsewhere, trashNoteWithImages } from "./noteLifecycle";
import { notesService } from "./notes";

describe("image cascade (images follow their note into Archive/Trash)", () => {
  test("extracts rel image srcs, normalizes storage:, dedupes, skips remote", () => {
    const body = [
      "# Note",
      "![a](storage/pic.png)",
      "![b](storage:shot.png)",
      "![again](storage/pic.png)",
      "![web](https://example.com/x.png)",
      "![inline](data:image/png;base64,xx)",
      "plain [link](storage/doc.pdf) is not an image",
    ].join("\n");
    expect(noteImageRels(body).sort()).toEqual(["storage/pic.png", "storage/shot.png"]);
  });

  test("referencedElsewhere: another note's hit blocks the cascade; own note doesn't", async () => {
    const search = async () => [{ id: "01OTHER" }];
    expect(await referencedElsewhere("storage/pic.png", "01ME", search)).toBe(true);
    const onlyMe = async () => [{ id: "01ME" }];
    expect(await referencedElsewhere("storage/pic.png", "01ME", onlyMe)).toBe(false);
    const nobody = async () => [];
    expect(await referencedElsewhere("storage/pic.png", "01ME", nobody)).toBe(false);
  });

  test("a failed reference check is CONSERVATIVE — counts as referenced", async () => {
    const boom = async () => {
      throw new Error("search down");
    };
    expect(await referencedElsewhere("storage/pic.png", "01ME", boom)).toBe(true);
  });
});

// Round Three (2026-09-26): a trashed note keeps its id, so its tab kept
// resolving. Trash closes the note's tabs once the move has landed.
describe("trash closes the note's tabs", () => {
  async function withClosedTabs(run: (closed: string[]) => Promise<void>) {
    const closed: string[] = [];
    const original = usePanesStore.getState().closeNoteTabs;
    usePanesStore.setState({ closeNoteTabs: (id: string) => void closed.push(id) });
    try {
      await run(closed);
    } finally {
      usePanesStore.setState({ closeNoteTabs: original });
    }
  }

  test("closes the tabs after the note lands in Trash", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Old plan\n\nDone with it.");
    await withClosedTabs(async (closed) => {
      const trashed = await trashNoteWithImages(note.id);
      expect(trashed.folderId).toBe(DEST.trash);
      expect(closed).toEqual([note.id]);
    });
  });

  test("a failed trash leaves the tabs open", async () => {
    await withClosedTabs(async (closed) => {
      await expect(trashNoteWithImages("01MISSINGNOTE0000000000000")).rejects.toThrow();
      expect(closed).toEqual([]);
    });
  });
});
