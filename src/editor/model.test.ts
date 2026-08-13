// The shared document buffer — ONE buffer per noteId across all tabs/panes
// (the r2 structural lock #4). These lock the synchronous buffer behaviour
// (typing never waits on a store round-trip): ensureDocument seeds without
// clobbering a live buffer, editDocument mutates in place and feeds the next
// edit, and evictDocument tears the buffer (and its pending sync) down.
//
// The debounced service sync is NOT exercised here — notesService routes to the
// Tauri corpus, which only exists inside the shell. Every test evicts its
// buffers in cleanup, which clears the pending 400ms timer, so no stray sync
// (and no unhandled rejection) escapes the test.

import { afterEach, describe, expect, test } from "bun:test";

import {
  documentSaveError,
  editDocument,
  ensureDocument,
  evictDocument,
  flushNote,
  reloadDocumentIfClean,
  setWriteNoteBodyForTests,
} from "./model";

// Track buffer ids we create so cleanup can clear their pending sync timers.
const touched = new Set<string>();
function buffer(id: string, body: string): void {
  touched.add(id);
  ensureDocument(id, body, `test:${id}:1`);
}

/** Read the live buffer via the edit seam without mutating it. */
function read(id: string): readonly string[] | undefined {
  let seen: readonly string[] | undefined;
  let ran = false;
  editDocument(id, (lines) => {
    ran = true;
    seen = lines;
    return [...lines]; // identity edit
  });
  return ran ? seen : undefined;
}

afterEach(() => {
  for (const id of touched) evictDocument(id);
  touched.clear();
});

describe("ensureDocument", () => {
  test("seeds a buffer by splitting the body on newlines", () => {
    buffer("seed", "line one\nline two");
    expect(read("seed")).toEqual(["line one", "line two"]);
  });

  test("does NOT clobber an existing live buffer (the live buffer is the truth)", () => {
    buffer("live", "alpha");
    editDocument("live", (lines) => [...lines, "beta"]);
    ensureDocument("live", "STALE FROM QUERY", "test:live:stale"); // must be ignored
    expect(read("live")).toEqual(["alpha", "beta"]);
  });
});

describe("reloadDocumentIfClean", () => {
  test("adopts disk truth when the buffer is clean", () => {
    touched.add("clean");
    ensureDocument("clean", "old", "test:clean:1");
    reloadDocumentIfClean("clean", "from disk", "test:clean:2");
    expect(read("clean")).toEqual(["from disk"]);
  });

  test("does NOT clobber a dirty buffer", () => {
    buffer("dirty", "old");
    editDocument("dirty", () => ["local edit"]);
    reloadDocumentIfClean("dirty", "from disk", "test:dirty:2");
    expect(read("dirty")).toEqual(["local edit"]);
  });

  test("seeds when the buffer does not exist yet", () => {
    touched.add("fresh");
    reloadDocumentIfClean("fresh", "hello", "test:fresh:1");
    expect(read("fresh")).toEqual(["hello"]);
  });
});

describe("editDocument", () => {
  test("applies the edit and feeds the updated buffer to the next edit", () => {
    buffer("edit", "x");
    editDocument("edit", (lines) => [...lines, "y"]);
    let next: readonly string[] = [];
    editDocument("edit", (lines) => {
      next = lines;
      return [...lines];
    });
    expect(next).toEqual(["x", "y"]);
  });

  test("is a no-op on an unknown buffer (callback never runs)", () => {
    let ran = false;
    editDocument("ghost", () => {
      ran = true;
      return [];
    });
    expect(ran).toBe(false);
  });
});

// The loss bug from the 2026-07-30 perf audit (correctness #1): every sync
// failure except "unknown note" was swallowed — a read-only volume or full
// disk left typed content only in the buffer, with no signal beyond a muted
// dot. These lock the new contract: the buffer is KEPT, the failure SURFACES,
// and a later successful write clears it.
describe("sync failure surfacing", () => {
  afterEach(() => {
    setWriteNoteBodyForTests(null);
  });

  test("a failed write keeps the buffer and surfaces the error", async () => {
    setWriteNoteBodyForTests(() => Promise.reject(new Error("disk full")));
    buffer("fail", "hello");
    editDocument("fail", () => ["hello world"]);
    await flushNote("fail");
    expect(read("fail")).toEqual(["hello world"]);
    expect(documentSaveError("fail")).toBe("disk full");
  });

  test("a save presents the revision that supplied the edited buffer", async () => {
    let presented = "";
    setWriteNoteBodyForTests((_id, _body, expectedRevision) => {
      presented = expectedRevision;
      return Promise.reject(new Error("revision conflict: external edit"));
    });
    buffer("conflict", "old");
    editDocument("conflict", () => ["local"]);
    await flushNote("conflict");
    expect(presented).toBe("test:conflict:1");
    expect(read("conflict")).toEqual(["local"]);
    expect(documentSaveError("conflict")).toContain("revision conflict");
  });

  test("a later successful write clears the surfaced error", async () => {
    let failures = 1;
    setWriteNoteBodyForTests(() =>
      failures-- > 0 ? Promise.reject(new Error("transient")) : Promise.resolve(),
    );
    buffer("recover", "x");
    editDocument("recover", () => ["y"]);
    await flushNote("recover");
    expect(documentSaveError("recover")).toBe("transient");
    editDocument("recover", () => ["z"]);
    await flushNote("recover");
    expect(documentSaveError("recover")).toBeNull();
  });

  test("an external rename/delete never discards the only local draft", async () => {
    setWriteNoteBodyForTests(() => Promise.reject(new Error("unknown note: ghost2")));
    buffer("ghost2", "x");
    editDocument("ghost2", () => ["y"]);
    await flushNote("ghost2");
    expect(read("ghost2")).toEqual(["y"]);
    expect(documentSaveError("ghost2")).toBe("unknown note: ghost2");
  });

  test("evicting a note clears its surfaced error", async () => {
    setWriteNoteBodyForTests(() => Promise.reject(new Error("io error")));
    buffer("gone", "x");
    editDocument("gone", () => ["y"]);
    await flushNote("gone");
    expect(documentSaveError("gone")).toBe("io error");
    evictDocument("gone");
    expect(documentSaveError("gone")).toBeNull();
  });
});

describe("evictDocument", () => {
  test("drops the buffer so later edits are no-ops", () => {
    buffer("evictme", "data");
    evictDocument("evictme");
    expect(read("evictme")).toBeUndefined();
  });

  test("is safe to call on a buffer that never existed", () => {
    expect(() => evictDocument("never")).not.toThrow();
  });
});
