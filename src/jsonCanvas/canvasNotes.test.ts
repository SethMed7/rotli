import { expect, test } from "bun:test";

import type { Note } from "../types";
import { cardAccess, cardView } from "./canvasNotes";

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

test("a card judges the body it holds: a secret pasted in after it opened closes it at once", () => {
  const books = { title: "Books" };
  const read = (body: string, extra: Partial<Note> = {}) => ({
    status: "success" as const,
    data: { id: "b", title: "Books", body, folderId: "wiki", updatedAt: 0, ...extra } as Note,
  });
  expect(cardView(books, "open", read("# Books\n\nDune."))).toEqual({
    title: "Books",
    body: "# Books\n\nDune.",
    secure: false,
  });
  // the projection still says open, but the body now holds a key: title only
  expect(cardView(books, "open", read("# Books\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n"))).toEqual({
    title: "Books",
    body: null,
    secure: true,
  });
  expect(cardView(books, "open", read("# Books", { secure: true }))).toMatchObject({
    secure: true,
    body: null,
  });
  // never read when the projection hasn't opened it
  expect(cardView(books, "secure", read("# Books\n\nDune."))).toEqual({
    title: "Books",
    body: null,
    secure: true,
  });
  expect(cardView(books, "unknown", undefined)).toEqual({ title: "Books", body: null, secure: false });
});

test("a read that fails says so and isn't mistaken for a note that's gone", () => {
  const books = { title: "Books" };
  expect(cardView(books, "open", { status: "error", data: undefined })).toEqual({
    title: "Books",
    body: null,
    secure: false,
    failed: true,
  });
  expect(cardView(books, "open", { status: "success", data: null })).toBe("gone");
  expect(cardView(books, "open", { status: "pending", data: undefined })).toEqual({
    title: "Books",
    body: null,
    secure: false,
  });
});
