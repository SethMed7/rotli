import { describe, expect, test } from "bun:test";

import { managedFileNote } from "./fileKind";

describe("managed file details", () => {
  test("only storage/ files carry the not-tracked-by-git fact", () => {
    expect(managedFileNote("storage/rotli/plan.docx")).toContain("not tracked by git");
    expect(managedFileNote("wiki/projects/reference.pdf")).toBeNull();
  });
});
