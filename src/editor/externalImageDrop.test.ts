import { describe, expect, test } from "bun:test";

import {
  dropEditorHost,
  importImagesAtDrop,
  isEmbeddablePath,
  isImagePath,
  nativeDropPoints,
  storageImageSource,
} from "./externalImageDrop";

describe("native image drop routing", () => {
  test("resolves a nested image hit to the CodeMirror root", () => {
    const editor = {} as HTMLElement;
    const nestedImage = { closest: (selector: string) => (selector === ".cm-editor" ? editor : null) };
    expect(dropEditorHost(nestedImage as unknown as Element)).toBe(editor);
    expect(dropEditorHost(null)).toBeNull();
  });

  test("a drop on the note surface outside the text body still targets its editor", () => {
    const editor = {} as HTMLElement;
    const surface = { querySelector: (selector: string) => (selector === ".cm-editor" ? editor : null) };
    const header = { closest: (selector: string) => (selector === ".editor" ? surface : null) };
    expect(dropEditorHost(header as unknown as Element)).toBe(editor);
    const elsewhere = { closest: () => null };
    expect(dropEditorHost(elsewhere as unknown as Element)).toBeNull();
  });

  test("videos are embeddable on the path lane but are never images", () => {
    expect(isEmbeddablePath("/tmp/clip.MP4")).toBe(true);
    expect(isEmbeddablePath("/tmp/clip.webm")).toBe(true);
    expect(isEmbeddablePath("/tmp/photo.png")).toBe(true);
    expect(isImagePath("/tmp/clip.mp4")).toBe(false);
    expect(isEmbeddablePath("/tmp/notes.md")).toBe(false);
  });

  test("turns default and named-root imports into the same portable storage source", () => {
    expect(storageImageSource("storage/photo.png")).toBe("storage:photo.png");
    expect(storageImageSource("research:storage/photo.png")).toBe("storage:photo.png");
    expect(storageImageSource("research:Storage/Photo.PNG")).toBe("storage:Photo.PNG");
  });

  test("accepts Finder image names without trusting MIME metadata", () => {
    expect(isImagePath("/tmp/Screenshot 2026-09-01.PNG")).toBe(true);
    expect(isImagePath("/tmp/diagram.svg")).toBe(true);
    expect(isImagePath("/tmp/notes.md")).toBe(false);
  });

  test("tries physical-to-CSS coordinates and the raw runtime coordinates", () => {
    expect(nativeDropPoints(400, 200, 2)).toEqual([
      { x: 200, y: 100 },
      { x: 400, y: 200 },
    ]);
    expect(nativeDropPoints(40, 20, 1)).toEqual([{ x: 40, y: 20 }]);
  });
});

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

  test("keeps a named-vault import root-relative to its note", async () => {
    const dispatched: Array<{ from: number; insert: string; anchor: number }> = [];
    const view = {
      posAtCoords: () => 4,
      state: {
        selection: { main: { head: 4 } },
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

    await importImagesAtDrop(view, ["/tmp/photo.png"], { x: 20, y: 40 }, async () =>
      Promise.resolve("research:storage/photo.png"),
    );

    expect(dispatched[0]?.insert).toBe("\n![](storage:photo.png)\n");
  });

  for (const { label, source } of [
    { label: "bulleted", source: "- " },
    { label: "numbered", source: "1. " },
    { label: "task", source: "- [ ] " },
    { label: "result", source: "- [ ][ ] " },
    { label: "choice", source: "- ( ) " },
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

describe("importImagesAtDrop on a whitespace-only line", () => {
  test("fills the line in place and keeps its hanging indent between photos", async () => {
    const dispatched: Array<{ from: number; insert: string; anchor: number }> = [];
    const doc = "- [x][ ] Hello — fail\n         ";
    const view = {
      posAtCoords: () => doc.length,
      state: {
        selection: { main: { head: doc.length } },
        doc: { lineAt: () => ({ from: 22, to: doc.length, text: "         " }) },
      },
      dispatch(spec: { changes: { from: number; insert: string }; selection: { anchor: number } }) {
        dispatched.push({
          from: spec.changes.from,
          insert: spec.changes.insert,
          anchor: spec.selection.anchor,
        });
      },
      focus() {},
    };
    await importImagesAtDrop(
      view,
      ["/tmp/a.png", "/tmp/b.png"],
      { x: 0, y: 0 },
      async (path) => `storage/${path.split("/").pop()}`,
    );
    expect(dispatched).toEqual([
      {
        from: doc.length,
        insert: "![](storage:a.png)\n         ![](storage:b.png)\n",
        anchor: doc.length + "![](storage:a.png)\n         ![](storage:b.png)\n".length,
      },
    ]);
  });
});
