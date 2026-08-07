import { describe, expect, test } from "bun:test";

import { importImagesAtDrop } from "./externalImageDrop";

describe("importImagesAtDrop", () => {
  test("keeps the pointer position captured before asynchronous imports", async () => {
    let resolveImport!: (wire: string) => void;
    const imported = new Promise<string>((resolve) => {
      resolveImport = resolve;
    });
    let pointerPosition = 4;
    const dispatched: Array<{ from: number; insert: string; anchor: number }> = [];
    const view = {
      posAtCoords: () => pointerPosition,
      state: { selection: { main: { head: 1 } } },
      dispatch: ({
        changes,
        selection,
      }: {
        changes: { from: number; insert: string };
        selection: { anchor: number };
      }) => dispatched.push({ ...changes, anchor: selection.anchor }),
      focus: () => {},
    };

    const dropping = importImagesAtDrop(view, ["/tmp/photo.png"], { x: 20, y: 40 }, () => imported);
    pointerPosition = 12;
    resolveImport("storage/photo.png");
    await dropping;

    expect(dispatched).toEqual([
      {
        from: 4,
        insert: "\n![](storage:photo.png)\n",
        anchor: 28,
      },
    ]);
  });
});
