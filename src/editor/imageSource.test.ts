import { expect, test } from "bun:test";

import { healable, noteImageLink, noteRelativePath } from "./imageSource";

test("a note-relative image path resolves against the note's folder", () => {
  expect(noteRelativePath("Garden/Roses", "img/rose.png")).toBe("Garden/Roses/img/rose.png");
  expect(noteRelativePath("Garden/Roses", "../shared/bed.png")).toBe("Garden/shared/bed.png");
  expect(noteRelativePath("Garden", "./photo.png")).toBe("Garden/photo.png");
  expect(noteRelativePath("", "photo.png")).toBe("photo.png");
});

test("escapes, angle brackets, and a leading slash read the way Markdown apps write them", () => {
  expect(noteRelativePath("Garden", "my%20rose.png")).toBe("Garden/my rose.png");
  expect(noteRelativePath("Garden", "<my rose.png>")).toBe("Garden/my rose.png");
  expect(noteRelativePath("Garden/Roses", "/attachments/rose.png")).toBe("attachments/rose.png");
  expect(noteRelativePath("Garden", "50%.png")).toBe("Garden/50%.png");
});

test("a path that climbs out of the vault, or a URL, is never a vault file", () => {
  expect(noteRelativePath("Garden", "../../etc/passwd.png")).toBeNull();
  expect(noteRelativePath("", "../x.png")).toBeNull();
  expect(noteRelativePath("Garden", "https://example.com/x.png")).toBeNull();
  expect(noteRelativePath("Garden", "storage:images/x.png")).toBeNull();
  expect(noteRelativePath("Garden", "")).toBeNull();
});

test("only Rotli's own storage: links may be repaired by rewriting the note", () => {
  expect(healable("storage:images/rose.png")).toBe(true);
  expect(healable("img/rose.png")).toBe(false);
  expect(healable("rose.png")).toBe(false);
  expect(healable("../attachments/rose.png")).toBe(false);
});

test("a new image is linked from the note's folder, and the link reads back to the file", () => {
  expect(noteImageLink("storage/images/rose.png", "wiki/_inbox")).toBe("../../storage/images/rose.png");
  expect(noteImageLink("storage/images/rose.png", "")).toBe("storage/images/rose.png");
  expect(noteImageLink("vault:storage/images/rose.png", "wiki")).toBe("../storage/images/rose.png");
  expect(noteImageLink("Garden/img/my rose (2).png", "Garden")).toBe("img/my%20rose%20%282%29.png");
  for (const [wire, folder] of [
    ["storage/images/rose.png", "wiki/_inbox"],
    ["Garden/img/my rose (2).png", "Garden/Beds"],
    ["Storage/a b.png", ""],
  ] as const) {
    const rel = wire.replace(/^[^/:]+:(?=[^/])/, "");
    expect(noteRelativePath(folder, noteImageLink(wire, folder))).toBe(rel);
  }
});
