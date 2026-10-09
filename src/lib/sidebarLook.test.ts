import { expect, test } from "bun:test";

import { DEFAULT_SIDEBAR_LOOK, iconKind, parseSidebarLook, showsBottom, showsTop } from "./sidebarLook";

test("the saved look reads tolerantly: a quiet top scene and neutral icons by default", () => {
  expect(parseSidebarLook(undefined)).toEqual(DEFAULT_SIDEBAR_LOOK);
  expect(DEFAULT_SIDEBAR_LOOK).toEqual({ scenery: "top", icons: "neutral" });
  expect(parseSidebarLook({ scenery: "both", icons: "color" })).toEqual({ scenery: "both", icons: "color" });
  expect(parseSidebarLook({ scenery: "sideways", icons: 3 })).toEqual(DEFAULT_SIDEBAR_LOOK);
});

test("which bands a scenery choice shows", () => {
  expect([showsTop("off"), showsBottom("off")]).toEqual([false, false]);
  expect([showsTop("top"), showsBottom("top")]).toEqual([true, false]);
  expect([showsTop("bottom"), showsBottom("bottom")]).toEqual([false, true]);
  expect([showsTop("both"), showsBottom("both")]).toEqual([true, true]);
});

test("each row's icon kind, for Color mode", () => {
  expect(iconKind({ kind: "board", title: "Plan" })).toBe("board");
  expect(iconKind({ kind: "note", title: "Notes.pdf" })).toBe("note");
  expect(iconKind({ kind: "file", title: "Report.PDF" })).toBe("pdf");
  expect(iconKind({ kind: "file", title: "mark.svg" })).toBe("svg");
  expect(iconKind({ kind: "file", title: "Brief.docx" })).toBe("word");
  expect(iconKind({ kind: "file", title: "photo.png" })).toBe("image");
  expect(iconKind({ kind: "file", title: "data.bin" })).toBe("note");
});
