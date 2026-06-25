// The exclusion + sink rules the listings and the lifecycle lean on. isHidden
// keeps Archive/Trash/Board out of All Notes and off the "freshest note" pick;
// isSink (Archive/Trash only) is the origin-rule predicate and MUST mirror
// corpus.rs is_hidden_root. Board is hidden from listings but is NOT a sink.

import { describe, expect, it } from "bun:test";
import {
  DEST,
  HIDDEN_ROOTS,
  isHidden,
  isRootMarker,
  isSink,
  isVault,
  SINK_ROOTS,
  VAULT_MARKER,
} from "./destinations";

describe("DEST + the root sets", () => {
  it("names the six reserved roots by their own folder ids", () => {
    expect(DEST).toEqual({
      inbox: "Inbox",
      vault: "vault:",
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
    expect(isHidden("Storage")).toBe(false);
    expect(isHidden("Storage/Work")).toBe(false);
    // the external Vault is not a SINK/hidden root — it's excluded from All
    // Notes by isVault, a separate predicate (browsed only via its own row).
    expect(isHidden("vault:")).toBe(false);
    expect(isHidden("vault:wiki")).toBe(false);
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
    expect(isSink("Storage")).toBe(false);
    expect(isSink("vault:wiki")).toBe(false);
    expect(isSink("")).toBe(false);
  });
});

describe("isVault — the external-root predicate (Brain→Vault rename)", () => {
  it("is true for the marker and anything inside the Vault root", () => {
    expect(isVault(VAULT_MARKER)).toBe(true);
    expect(isVault("vault:")).toBe(true);
    expect(isVault("vault:wiki")).toBe(true);
    expect(isVault("vault:chats/x.md")).toBe(true);
  });

  it("is false for every LOCAL (bare, default-root) id", () => {
    expect(isVault("Inbox")).toBe(false);
    expect(isVault("Storage/Work")).toBe(false);
    expect(isVault("Brain")).toBe(false); // a plain local folder after the rename
    expect(isVault("")).toBe(false);
  });
});

describe("the WRITE MODEL redirect — note-creation never lands in the Vault", () => {
  // The three creation paths (⌘N actions.newNote, Sidebar resolvedParent for
  // boards/folders, QuickNote.newNote) all gate on isVault(target) and fall back
  // to the LOCAL Inbox. This proves the predicate fires for every Vault target a
  // selection/quickFolder could carry, and passes through every local target.
  const redirect = (target: string, inbox = "Inbox") => (isVault(target) ? inbox : target);

  it("redirects the Vault marker and any folder/note inside it to the local Inbox", () => {
    expect(redirect("vault:")).toBe("Inbox");
    expect(redirect("vault:wiki")).toBe("Inbox");
    expect(redirect("vault:chats")).toBe("Inbox");
    expect(redirect("vault:chats/x.md")).toBe("Inbox");
  });

  it("leaves every LOCAL destination untouched (no redirect)", () => {
    expect(redirect("Inbox")).toBe("Inbox");
    expect(redirect("Storage")).toBe("Storage");
    expect(redirect("Storage/Work")).toBe("Storage/Work");
    expect(redirect("Brain")).toBe("Brain"); // a plain local folder after the rename
  });
});

describe("isRootMarker — a bare non-default root '<rootid>:'", () => {
  it("is true only for an id that is a rootid followed by a single trailing colon", () => {
    expect(isRootMarker("vault:")).toBe(true);
  });

  it("is false for bare default ids, in-root paths, and lookalikes", () => {
    expect(isRootMarker("Inbox")).toBe(false); // bare default → no marker
    expect(isRootMarker("vault:wiki")).toBe(false); // a folder inside the root
    expect(isRootMarker(":")).toBe(false); // empty rootid
    expect(isRootMarker("")).toBe(false);
  });
});
