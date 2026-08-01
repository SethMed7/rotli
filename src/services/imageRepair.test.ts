import { describe, expect, test } from "bun:test";

import { classifyLostImage, imageSrcToRel } from "./imageRepair";

const file = (id: string, folderId = "Storage") => ({ id, folderId, kind: "file" });

describe("image link self-repair classification", () => {
  test("a single live file with the same basename means MOVED to its new path", () => {
    const loc = classifyLostImage("storage/pic.png", [file("storage/2026/pic.png")], "default");
    expect(loc).toEqual({ kind: "moved", rel: "storage/2026/pic.png" });
  });

  test("storage: shorthand normalizes before matching", () => {
    expect(imageSrcToRel("storage:pic.png")).toBe("storage/pic.png");
    const loc = classifyLostImage("storage:pic.png", [file("assets/pic.png")], "default");
    expect(loc).toEqual({ kind: "moved", rel: "assets/pic.png" });
  });

  test("matches only in the Trash read as TRASHED, never not-found", () => {
    const loc = classifyLostImage("storage/pic.png", [file("Trash/pic.png", "Trash")], "default");
    expect(loc).toEqual({ kind: "trashed" });
  });

  test("a live match beats a trashed twin", () => {
    const loc = classifyLostImage(
      "storage/pic.png",
      [file("Trash/pic.png", "Trash"), file("assets/pic.png")],
      "default",
    );
    expect(loc).toEqual({ kind: "moved", rel: "assets/pic.png" });
  });

  test("ambiguous (two live candidates) refuses to guess — missing", () => {
    const loc = classifyLostImage("storage/pic.png", [file("a/pic.png"), file("b/pic.png")], "default");
    expect(loc).toEqual({ kind: "missing" });
  });

  test("nothing anywhere is MISSING; the failed original never counts as a candidate", () => {
    expect(classifyLostImage("storage/pic.png", [], "default")).toEqual({ kind: "missing" });
    expect(classifyLostImage("storage/pic.png", [file("storage/pic.png")], "default")).toEqual({
      kind: "missing",
    });
  });

  test("candidates from OTHER roots never repair this note's link", () => {
    const loc = classifyLostImage("storage/pic.png", [file("vault:wiki/pic.png")], "default");
    expect(loc).toEqual({ kind: "missing" });
    const vaultLoc = classifyLostImage("storage/pic.png", [file("vault:wiki/pic.png")], "vault");
    expect(vaultLoc).toEqual({ kind: "moved", rel: "wiki/pic.png" });
  });

  test("notes and boards in the listing are ignored — only files repair images", () => {
    const note = { id: "01NOTE", folderId: "Inbox", kind: "note" };
    expect(classifyLostImage("pic.png", [note], "default")).toEqual({ kind: "missing" });
  });

  test("an archived match renders from the Archive but never heals the link", () => {
    const loc = classifyLostImage("storage/pic.png", [file("Archive/pic.png", "Archive")], "default");
    expect(loc).toEqual({ kind: "archived", rel: "Archive/pic.png" });
  });

  test("a live match beats an archived one; archived beats trashed", () => {
    expect(
      classifyLostImage(
        "storage/pic.png",
        [file("Archive/pic.png", "Archive"), file("assets/pic.png")],
        "default",
      ),
    ).toEqual({ kind: "moved", rel: "assets/pic.png" });
    expect(
      classifyLostImage(
        "storage/pic.png",
        [file("Archive/pic.png", "Archive"), file("Trash/pic.png", "Trash")],
        "default",
      ),
    ).toEqual({ kind: "archived", rel: "Archive/pic.png" });
  });
});
