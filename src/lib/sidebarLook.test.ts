import { expect, test } from "bun:test";

import { DEFAULT_SIDEBAR_LOOK, iconKind, parseSidebarLook } from "./sidebarLook";

test("the saved look reads tolerantly: neutral icons by default", () => {
  expect(parseSidebarLook(undefined)).toEqual(DEFAULT_SIDEBAR_LOOK);
  expect(DEFAULT_SIDEBAR_LOOK).toEqual({ icons: "neutral" });
  expect(parseSidebarLook({ icons: "color" })).toEqual({ icons: "color" });
  expect(parseSidebarLook({ icons: 3 })).toEqual(DEFAULT_SIDEBAR_LOOK);
});

test("a look saved with the retired scenery choice still loads, and drops it", () => {
  expect(parseSidebarLook({ scenery: "both", icons: "color" })).toEqual({ icons: "color" });
  expect(parseSidebarLook({ scenery: "sideways" })).toEqual(DEFAULT_SIDEBAR_LOOK);
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
