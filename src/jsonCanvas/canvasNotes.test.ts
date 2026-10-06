import { expect, test } from "bun:test";

import { cardAccess } from "./canvasNotes";

const note = (id: string, extra: { secure?: boolean; folderId?: string; diskFolderId?: string } = {}) => ({
  id,
  folderId: "wiki/Projects",
  ...extra,
});

test("a note card shows nothing until the Links projection answers, and fails closed after", () => {
  const rows = new Map([
    ["open", false],
    ["flagged-by-rust", true],
  ]);
  // still loading: neither shown nor called secure
  expect(cardAccess(note("open"), "pending", rows)).toBe("unknown");
  // the projection failed: secure, whatever else is true
  expect(cardAccess(note("open"), "error", rows)).toBe("secure");
  expect(cardAccess(note("open"), "success", rows)).toBe("open");
  expect(cardAccess(note("flagged-by-rust"), "success", rows)).toBe("secure");
  // a note the projection never listed (another vault) stays closed
  expect(cardAccess(note("elsewhere"), "success", rows)).toBe("secure");
});

test("the note's own flag or a secure folder closes it before the projection is even asked", () => {
  const rows = new Map([["open", false]]);
  expect(cardAccess(note("open", { secure: true }), "pending", rows)).toBe("secure");
  expect(cardAccess(note("open", { folderId: "Secure notes/Keys" }), "success", rows)).toBe("secure");
  expect(cardAccess(note("open", { folderId: "Inbox", diskFolderId: "wiki/_secure" }), "success", rows)).toBe(
    "secure",
  );
});
