// The exclusion + sink rules the listings and the lifecycle lean on. isHidden
// keeps Archive/Trash/Board out of All Notes and off the "freshest note" pick;
// isSink (Archive/Trash only) is the origin-rule predicate and MUST mirror
// corpus.rs is_hidden_root. Board is hidden from listings but is NOT a sink.

import { describe, expect, it } from "bun:test";
import { DEST, HIDDEN_ROOTS, isHidden, isSink, SINK_ROOTS } from "./destinations";

describe("DEST + the root sets", () => {
  it("names the six reserved roots by their own folder ids", () => {
    expect(DEST).toEqual({
      inbox: "Inbox",
      brain: "Brain",
      storage: "Storage",
      board: "Board",
      archive: "Archive",
      trash: "Trash",
    });
  });

  it("hides Archive, Trash, and Board from listings", () => {
    expect(HIDDEN_ROOTS).toEqual([DEST.archive, DEST.trash, DEST.board]);
  });

  it("treats only Archive and Trash as never-delete sinks", () => {
    expect(SINK_ROOTS).toEqual([DEST.archive, DEST.trash]);
  });
});

describe("isHidden", () => {
  it("is true for each hidden root and its descendants (ids are paths)", () => {
    expect(isHidden("Archive")).toBe(true);
    expect(isHidden("Trash")).toBe(true);
    expect(isHidden("Board")).toBe(true);
    expect(isHidden("Archive/Old")).toBe(true);
    expect(isHidden("Board/2026")).toBe(true);
  });

  it("is false for the everyday destinations and their subtrees", () => {
    expect(isHidden("Inbox")).toBe(false);
    expect(isHidden("Brain")).toBe(false);
    expect(isHidden("Brain/Work")).toBe(false);
    expect(isHidden("Storage")).toBe(false);
  });

  it("is false for the corpus root and for mere prefix lookalikes", () => {
    expect(isHidden("")).toBe(false);
    expect(isHidden("Archived")).toBe(false);
    expect(isHidden("Boardroom")).toBe(false);
  });
});

describe("isSink — the origin-rule predicate (mirrors Rust is_hidden_root)", () => {
  it("is true for Archive and Trash and their subtrees", () => {
    expect(isSink("Archive")).toBe(true);
    expect(isSink("Trash")).toBe(true);
    expect(isSink("Trash/2024/q1")).toBe(true);
  });

  it("is FALSE for Board (hidden from listings, but not a sink)", () => {
    expect(isSink("Board")).toBe(false);
    expect(isSink("Board/x")).toBe(false);
  });

  it("is false for the everyday destinations and the root", () => {
    expect(isSink("Inbox")).toBe(false);
    expect(isSink("Brain")).toBe(false);
    expect(isSink("")).toBe(false);
  });
});
