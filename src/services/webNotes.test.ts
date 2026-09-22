import { describe, expect, test } from "bun:test";

import { folderIsEmpty } from "./webNotes";

describe("a connected folder that becomes a vault", () => {
  test("an empty folder is empty, and so is one holding only what the Finder or the page itself left", () => {
    expect(folderIsEmpty([])).toBe(true);
    expect(folderIsEmpty([{ name: ".DS_Store" }])).toBe(true);
    expect(folderIsEmpty([{ name: ".rotli" }, { name: ".DS_Store" }])).toBe(true);
  });
  test("a folder with anything of the user's own is an existing vault, never seeded over", () => {
    expect(folderIsEmpty([{ name: "wiki" }])).toBe(false);
    expect(folderIsEmpty([{ name: "README.md" }, { name: ".rotli" }])).toBe(false);
  });
});
