import { expect, test } from "bun:test";

import type { ICustomRange, IDocumentData } from "@univerjs/presets";

import { linkRange, opensOnPress, paragraphRuns, routeLinkOpens } from "./links";

const snapshot = (dataStream: string, body: Partial<NonNullable<IDocumentData["body"]>>): IDocumentData =>
  ({ id: "d", body: { dataStream, ...body } }) as IDocumentData;

test("a link Univer adds reads back as a linked run (the shape its add-link command writes)", () => {
  // what docs.command.add-hyper-link left on "Hello world": no markers, an inclusive end
  const added = snapshot("Hello world\r\n", {
    textRuns: [],
    customRanges: [
      { rangeId: "x", rangeType: 0, startIndex: 6, endIndex: 10, properties: { url: "https://example.com" } },
    ],
  });
  expect(paragraphRuns(added, 0, 11)).toEqual([
    { text: "Hello " },
    { text: "world", link: "https://example.com" },
  ]);
});

test("a link edge splits a styled run, and a link Rotli can't open keeps only its text", () => {
  const styled = snapshot("Bold link here\r\n", {
    textRuns: [{ st: 0, ed: 9, ts: { bl: 1 } }],
    customRanges: [
      { rangeId: "a", rangeType: 0, startIndex: 5, endIndex: 8, properties: { url: "mailto:hi@rotli.co" } },
      {
        rangeId: "b",
        rangeType: 0,
        startIndex: 10,
        endIndex: 13,
        properties: { url: "javascript:alert(1)" },
      },
    ],
  });
  expect(paragraphRuns(styled, 0, 14)).toEqual([
    { text: "Bold ", style: { bold: true } },
    { text: "link", style: { bold: true }, link: "mailto:hi@rotli.co" },
    { text: " " },
    { text: "here" },
  ]);
});

test("runs sharing a link become one range; separate paragraphs never merge", () => {
  const ranges: ICustomRange[] = [];
  linkRange(ranges, { text: "Ro", link: "https://rotli.co" }, 0, 2);
  linkRange(ranges, { text: "tli", style: { bold: true }, link: "https://rotli.co" }, 2, 5);
  linkRange(ranges, { text: " plain" }, 5, 11);
  // the next paragraph starts after the paragraph mark at 11
  linkRange(ranges, { text: "Rotli", link: "https://rotli.co" }, 12, 17);
  expect(ranges.map(({ startIndex, endIndex }) => [startIndex, endIndex])).toEqual([
    [0, 4],
    [12, 16],
  ]);
  expect(ranges[0]).toMatchObject({ rangeType: 0, properties: { url: "https://rotli.co" } });
});

test("while an editor is mounted, link opens go through Rotli's opener", () => {
  const w = window as unknown as { open: typeof window.open };
  const native: string[] = [];
  const previous = w.open;
  w.open = ((url?: string | URL) => {
    native.push(String(url));
    return null;
  }) as typeof window.open;
  try {
    const opened: string[] = [];
    // the opener's browser fallback calls window.open itself
    const release = routeLinkOpens((url) => {
      opened.push(url);
      window.open(url, "_blank");
    });
    const second = routeLinkOpens(() => undefined);
    window.open("https://rotli.co", "_blank", "noopener noreferrer");
    window.open("javascript:alert(1)", "_blank");
    expect(opened).toEqual(["https://rotli.co"]);
    expect(native).toEqual(["https://rotli.co"]);
    release();
    release();
    second();
    window.open("https://after.example", "_blank");
    expect(native).toEqual(["https://rotli.co", "https://after.example"]);
  } finally {
    w.open = previous;
  }
});

test("a plain click in the text edits it; a modifier click or the link's card opens it", () => {
  const canvas = { tagName: "CANVAS" } as unknown as EventTarget;
  const card = { tagName: "DIV" } as unknown as EventTarget;
  expect(opensOnPress({ metaKey: false, ctrlKey: false, target: canvas })).toBe(false);
  expect(opensOnPress({ metaKey: true, ctrlKey: false, target: canvas })).toBe(true);
  expect(opensOnPress({ metaKey: false, ctrlKey: true, target: canvas })).toBe(true);
  expect(opensOnPress({ metaKey: false, ctrlKey: false, target: card })).toBe(true);
  expect(opensOnPress(null)).toBe(false);
});
