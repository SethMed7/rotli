// The conflict-copy notices persisted in settings.json (ninth review of pull
// request 267: a copy made at quit was forgotten by the restart that followed).
import { describe, expect, test } from "bun:test";

import { parseSettings } from "./persist";

describe("conflict copies the person hasn't seen yet (ninth review)", () => {
  test("they are kept in settings.json, one per copy, and a malformed entry is dropped", () => {
    const entry = {
      copyId: "copy-7",
      copyName: "“Ledger (unsaved edits 2026-11-11 09:30)”",
      noteName: "“Ledger”",
    };
    expect(parseSettings(JSON.stringify({ copiedAside: [entry, { copyId: 7 }] })).copiedAside).toEqual([
      entry,
    ]);
    expect(parseSettings("{}").copiedAside).toEqual([]);
  });
});
