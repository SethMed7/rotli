import { describe, expect, test } from "bun:test";

import { usePanesStore } from "../state/panes";
import { activeItemSinkLane, fileLifecycleRows, readFileLifecycle, restoreSinkItem } from "./itemLifecycle";

describe("active item lifecycle routing", () => {
  test("boards use their note-native move lane instead of conventional file capabilities", () => {
    expect(activeItemSinkLane("note")).toBe("note");
    expect(activeItemSinkLane("board")).toBe("note");
    expect(activeItemSinkLane("file")).toBe("file");
  });
});

describe("restoring a board outside the Mac app", () => {
  test("Rotli Web restores a board through its folder service and closes the tab on the old path", async () => {
    const closed: string[] = [];
    const original = usePanesStore.getState().closeFileTabs;
    usePanesStore.setState({ closeFileTabs: (id: string) => void closed.push(id) });
    const restored: string[] = [];
    try {
      await restoreSinkItem({ id: "trash/storage/excalidraw/a.excalidraw", kind: "board" }, async (id) => {
        restored.push(id);
      });
    } finally {
      usePanesStore.setState({ closeFileTabs: original });
    }
    expect(restored).toEqual(["trash/storage/excalidraw/a.excalidraw"]);
    expect(closed).toEqual(["trash/storage/excalidraw/a.excalidraw"]);
  });
});

describe("file lifecycle menu rows", () => {
  test("a movable file offers Archive and Trash", async () => {
    const result = await readFileLifecycle(async () => ({ lifecycleMutable: true, lifecycleReason: null }));
    expect(fileLifecycleRows(result)).toEqual({
      movable: true,
      archiveLabel: "Move file to Archive",
      trashLabel: "Move file to Trash",
      error: null,
    });
  });

  test("an immovable file names Rust's reason", async () => {
    const result = await readFileLifecycle(async () => ({
      lifecycleMutable: false,
      lifecycleReason: "read-only vault",
    }));
    expect(fileLifecycleRows(result)).toMatchObject({
      movable: false,
      archiveLabel: "Can’t move file — read-only vault",
      error: null,
    });
  });

  test("a failed stat is an error, never read-only", async () => {
    const result = await readFileLifecycle(async () => {
      throw new Error("stat storage/rotli/a.docx: No such file");
    });
    const rows = fileLifecycleRows(result);
    expect(rows.movable).toBe(false);
    expect(rows.archiveLabel).toBe("Couldn’t read file details — stat storage/rotli/a.docx: No such file");
    expect(rows.trashLabel).toBe(rows.archiveLabel);
    expect(rows.error).toBe(rows.archiveLabel);
    expect(rows.archiveLabel).not.toContain("Read-only");
  });
});
