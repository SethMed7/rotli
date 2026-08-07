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
      state: {
        selection: { main: { head: 1 } },
        doc: { lineAt: () => ({ from: 0, to: 4, text: "body" }) },
      },
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

  for (const { label, source } of [
    { label: "bulleted", source: "- " },
    { label: "numbered", source: "1. " },
    { label: "task", source: "- [ ] " },
  ]) {
    test(`keeps a photo inside an empty ${label} list item`, async () => {
      const at = source.length;
      const dispatched: Array<{ from: number; insert: string; anchor: number }> = [];
      const view = {
        posAtCoords: () => at,
        state: {
          selection: { main: { head: at } },
          doc: {
            lineAt: () => ({ from: 0, to: source.length, text: source }),
          },
        },
        dispatch: ({
          changes,
          selection,
        }: {
          changes: { from: number; insert: string };
          selection: { anchor: number };
        }) => dispatched.push({ ...changes, anchor: selection.anchor }),
        focus: () => {},
      };

      await importImagesAtDrop(view, ["/tmp/photo.png"], { x: 10, y: 10 }, async () =>
        Promise.resolve("storage/photo.png"),
      );

      expect(dispatched[0]?.from).toBe(at);
      expect(dispatched[0]?.insert).toBe("![](storage:photo.png)\n");
      expect(source + (dispatched[0]?.insert ?? "")).toBe(`${source}![](storage:photo.png)\n`);
    });
  }
});
