// The creation router's decision logic (memex-is-the-home, Phase 2). Pure, so the
// branching is provable without the app; the actual writeNote/createNote I/O + the
// select-after-create are verified live.

import { describe, expect, test } from "bun:test";
import { routeDecision } from "./createNote";

const FALLBACK = "Inbox";

describe("routeDecision (memex-vs-local)", () => {
  test("no writable memex ⇒ always local", () => {
    expect(routeDecision("All notes", true, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
    expect(routeDecision("Storage/Work", false, false, FALLBACK)).toEqual({ kind: "local", folder: "Storage/Work" });
    // a vault selection with no writable memex still can't write the memex ⇒ local inbox
    expect(routeDecision("vault:Inbox", false, false, FALLBACK)).toEqual({ kind: "local", folder: FALLBACK });
  });

  test("writable memex + a smart row / the vault marker ⇒ memex, default shelf", () => {
    expect(routeDecision("All notes", true, true, FALLBACK)).toEqual({ kind: "memex" });
    expect(routeDecision("vault:", false, true, FALLBACK)).toEqual({ kind: "memex" });
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
    expect(routeDecision("Storage/Work", false, true, FALLBACK)).toEqual({ kind: "local", folder: "Storage/Work" });
    expect(routeDecision("Inbox", false, true, FALLBACK)).toEqual({ kind: "local", folder: "Inbox" });
  });
});
