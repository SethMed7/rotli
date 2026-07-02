// The exclusion + sink rules the listings and the lifecycle lean on. isHidden
// keeps Archive/Trash/Board out of All Notes and off the "freshest note" pick;
// isSink (Archive/Trash only) is the origin-rule predicate and MUST mirror
// corpus.rs is_hidden_root. Board is hidden from listings but is NOT a sink.

import { describe, expect, it } from "bun:test";
import {
  DEST,
  HIDDEN_ROOTS,
  isChats,
  isChatsPath,
  isHidden,
  isRootMarker,
  isSink,
  isTrash,
  isVault,
  memexMarkersOf,
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

describe("isTrash — the one root search never surfaces", () => {
  it("is true for Trash and its subtree, false for Archive (findable)", () => {
    expect(isTrash(DEST.trash)).toBe(true);
    expect(isTrash("Trash/Old")).toBe(true);
    expect(isTrash(DEST.archive)).toBe(false);
    expect(isTrash("Trashy")).toBe(false);
  });
});

describe("isChatsPath — the pure chats/ shape test", () => {
  it("matches bare and prefixed chats paths", () => {
    expect(isChatsPath("chats")).toBe(true);
    expect(isChatsPath("chats/2026")).toBe(true);
    expect(isChatsPath("vault:chats")).toBe(true);
    expect(isChatsPath("vault:chats/x")).toBe(true);
  });

  it("never matches notes folders or lookalikes", () => {
    expect(isChatsPath("Inbox")).toBe(false);
    expect(isChatsPath("wiki/projects")).toBe(false);
    expect(isChatsPath("chatscript")).toBe(false); // prefix must be a path segment
    expect(isChatsPath("vault:wiki")).toBe(false);
  });
});

describe("isChats — transcripts stay with the Chat front, in MEMEX roots only", () => {
  // a memex corpus + one connected brain — both roots own a Chat front
  const memexCorpus = memexMarkersOf({ corpus: { isMemex: true }, brains: [{ id: "vault" }] });
  // a plain corpus + the same brain — only the brain's chats/ is transcripts
  const plainCorpus = memexMarkersOf({ corpus: { isMemex: false }, brains: [{ id: "vault" }] });

  it("memexMarkersOf derives '' for a memex corpus + '<id>:' per brain", () => {
    expect([...memexCorpus].sort()).toEqual(["", "vault:"]);
    expect([...plainCorpus]).toEqual(["vault:"]);
  });

  it("matches chats paths only inside memex roots", () => {
    expect(isChats("chats", memexCorpus)).toBe(true);
    expect(isChats("chats/2026", memexCorpus)).toBe(true);
    expect(isChats("vault:chats/x", memexCorpus)).toBe(true);
    expect(isChats("vault:chats/x", plainCorpus)).toBe(true);
  });

  it("a PLAIN root's folder named 'chats' is just a folder (the search/All-notes fix)", () => {
    expect(isChats("chats", plainCorpus)).toBe(false);
    expect(isChats("chats/ideas", plainCorpus)).toBe(false);
    // an added plain folder root ("notes:") has no Chat front either
    expect(isChats("notes:chats/x", memexCorpus)).toBe(false);
  });

  it("never matches notes folders or lookalikes, in any layout", () => {
    expect(isChats("Inbox", memexCorpus)).toBe(false);
    expect(isChats("wiki/projects", memexCorpus)).toBe(false);
    expect(isChats("chatscript", memexCorpus)).toBe(false);
    expect(isChats("vault:wiki", memexCorpus)).toBe(false);
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
