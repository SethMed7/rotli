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
import { editDocument, ensureDocument, evictDocument, reloadDocumentIfClean } from "./model";

// Track buffer ids we create so cleanup can clear their pending sync timers.
const touched = new Set<string>();
function buffer(id: string, body: string): void {
  touched.add(id);
  ensureDocument(id, body);
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
    ensureDocument("live", "STALE FROM QUERY"); // must be ignored
    expect(read("live")).toEqual(["alpha", "beta"]);
  });
});

describe("reloadDocumentIfClean", () => {
  test("adopts disk truth when the buffer is clean", () => {
    touched.add("clean");
    ensureDocument("clean", "old");
    reloadDocumentIfClean("clean", "from disk");
    expect(read("clean")).toEqual(["from disk"]);
  });

  test("does NOT clobber a dirty buffer", () => {
    buffer("dirty", "old");
    editDocument("dirty", () => ["local edit"]);
    reloadDocumentIfClean("dirty", "from disk");
    expect(read("dirty")).toEqual(["local edit"]);
  });

  test("seeds when the buffer does not exist yet", () => {
    touched.add("fresh");
    reloadDocumentIfClean("fresh", "hello");
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
