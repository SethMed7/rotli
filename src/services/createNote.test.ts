// The creation router's decision logic (memex-is-the-home, Phase 2). Pure, so the
// branching is provable without the app; the actual writeNote/createNote I/O + the
// select-after-create are verified live.

import { describe, expect, test } from "bun:test";
import { routeDecision } from "./createNote";

const FALLBACK = "Inbox";

describe("routeDecision (memex-vs-local)", () => {
  test("no writable memex ⇒ always local", () => {
    expect(routeDecision("All notes", true, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    expect(routeDecision("Storage/Work", false, false, FALLBACK)).toEqual({
      kind: "local",
      folder: "Storage/Work",
    });
    // a vault selection with no writable memex still can't write the memex ⇒ local inbox
    expect(routeDecision("vault:Inbox", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
  });

  test("writable memex + a smart row / the vault marker ⇒ memex, default shelf", () => {
    expect(routeDecision("All notes", true, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("vault:", false, true, FALLBACK)).toEqual({ kind: "memex" });
  });

  test("a writable memex routes the Brain view and curated wiki areas through Brain intake", () => {
    expect(routeDecision("Brain", false, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("wiki", false, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("wiki/projects", false, true, FALLBACK)).toEqual({ kind: "memex" });

    // Without a memex these names can still be ordinary folders in a legacy
    // corpus, so the router preserves their explicit local meaning.
    expect(routeDecision("Brain", false, false, FALLBACK)).toEqual({ kind: "local", folder: "Brain" });
    expect(routeDecision("wiki/projects", false, false, FALLBACK)).toEqual({
      kind: "local",
      folder: "wiki/projects",
    });
  });

  test("writable memex + a selected SHELF folder ⇒ memex with that shelf", () => {
    expect(routeDecision("vault:Inbox", false, true, FALLBACK)).toEqual({ kind: "memex", shelf: ["Inbox"] });
    expect(routeDecision("vault:Myela/Payments", false, true, FALLBACK)).toEqual({
      kind: "memex",
      shelf: ["Myela/Payments"],
    });
  });

  test("writable memex + a memex STRUCTURAL folder (wiki/chats) ⇒ memex, default shelf (not those)", () => {
    expect(routeDecision("vault:wiki", false, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("vault:wiki/projects", false, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("vault:chats", false, true, FALLBACK)).toEqual({ kind: "memex" });
  });

  test("an EXPLICIT local folder is ALWAYS respected, even with a writable memex", () => {
    expect(routeDecision("Storage/Work", false, true, FALLBACK)).toEqual({
      kind: "local",
      folder: "Storage/Work",
    });
    expect(routeDecision("Inbox", false, true, FALLBACK)).toEqual({ kind: "local", folder: "Inbox" });
  });

  test("Secure notes remains a secure shelf when the corpus is a memex", () => {
    expect(routeDecision("Secure notes", false, true, FALLBACK)).toEqual({
      kind: "memex",
      shelf: ["Secure notes"],
    });
    expect(routeDecision("Secure notes/Calls", false, true, FALLBACK)).toEqual({
      kind: "memex",
      shelf: ["Secure notes/Calls"],
    });
    expect(routeDecision("Secure notes", false, false, FALLBACK)).toEqual({
      kind: "local",
      folder: "Secure notes",
    });
  });

  test("a HIDDEN root selection (Archive/Trash/Board) never births a note there (#5)", () => {
    // no memex: the sink selection falls back to the local Inbox
    expect(routeDecision("Archive", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    expect(routeDecision("Trash", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    expect(routeDecision("Trash/Old", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    expect(routeDecision("Board", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    // with a writable memex it routes like a smart row — into the staging default
    expect(routeDecision("Archive", false, true, FALLBACK)).toEqual({ kind: "memex" });
    // a folder that merely STARTS with a sink's name is a normal folder
    expect(routeDecision("Archives", false, false, FALLBACK)).toEqual({ kind: "local", folder: "Archives" });
  });
});
