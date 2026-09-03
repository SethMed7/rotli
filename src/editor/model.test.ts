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

import { notesService } from "../services/notes";
import {
  adoptPendingDocument,
  documentSaveError,
  editDocument,
  ensureDocument,
  ensurePendingDocument,
  evictDocument,
  flushNote,
  flushNoteAfterPaint,
  flushSyncs,
  reloadDocumentIfClean,
  setReadNoteForTests,
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
  setWriteNoteBodyForTests(null);
  setReadNoteForTests(null);
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

  test("adopts a new revision when Rotli moves a clean note without changing its body", async () => {
    let presented = "";
    setWriteNoteBodyForTests((_id, _body, expectedRevision) => {
      presented = expectedRevision;
      return Promise.resolve();
    });
    buffer("moved-clean", "same prose");

    reloadDocumentIfClean("moved-clean", "same prose", "test:moved-clean:2");
    editDocument("moved-clean", () => ["later edit"]);
    await flushNote("moved-clean");

    expect(presented).toBe("test:moved-clean:2");
  });

  test("rebases a dirty draft onto a metadata-only move revision", async () => {
    const writes: Array<{ body: string; revision: string }> = [];
    setWriteNoteBodyForTests((_id, body, expectedRevision) => {
      writes.push({ body, revision: expectedRevision });
      return Promise.resolve();
    });
    buffer("moved-dirty", "disk prose");
    editDocument("moved-dirty", () => ["local draft"]);

    reloadDocumentIfClean("moved-dirty", "disk prose", "test:moved-dirty:2");
    await flushNote("moved-dirty");

    expect(writes).toEqual([{ body: "local draft", revision: "test:moved-dirty:2" }]);
    expect(read("moved-dirty")).toEqual(["local draft"]);
  });

  test("keeps the old revision when both disk prose and the local draft changed", async () => {
    let presented = "";
    setWriteNoteBodyForTests((_id, _body, expectedRevision) => {
      presented = expectedRevision;
      return Promise.reject(new Error("revision conflict: external body edit"));
    });
    buffer("real-conflict", "original");
    editDocument("real-conflict", () => ["local draft"]);

    reloadDocumentIfClean("real-conflict", "external draft", "test:real-conflict:2");
    await flushNote("real-conflict");

    expect(presented).toBe("test:real-conflict:1");
    expect(read("real-conflict")).toEqual(["local draft"]);
    expect(documentSaveError("real-conflict")).toContain("revision conflict");
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

describe("optimistic pending documents", () => {
  afterEach(() => {
    setWriteNoteBodyForTests(null);
  });

  test("accepts first-paint typing and hands the draft to the durable note revision", async () => {
    const writes: Array<{ id: string; body: string; revision: string; base: string }> = [];
    setWriteNoteBodyForTests((id, body, revision, base) => {
      writes.push({ id, body, revision, base });
      return Promise.resolve();
    });
    touched.add("pending:tab");
    touched.add("durable-note");
    ensurePendingDocument("pending:tab");
    editDocument("pending:tab", () => ["typed before creation returned"]);

    expect(read("pending:tab")).toEqual(["typed before creation returned"]);
    expect(writes).toEqual([]);

    adoptPendingDocument("pending:tab", {
      id: "durable-note",
      title: "Untitled",
      snippet: "",
      folderId: "Inbox",
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      body: "",
      revision: "test:durable-note:1",
    });
    await flushNote("durable-note");

    expect(read("durable-note")).toEqual(["typed before creation returned"]);
    expect(writes).toEqual([
      {
        id: "durable-note",
        body: "typed before creation returned",
        revision: "test:durable-note:1",
        base: "",
      },
    ]);
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

  test("a late move-only refresh clears a false conflict and retries the kept draft", async () => {
    const revisions: string[] = [];
    setWriteNoteBodyForTests((_id, _body, expectedRevision) => {
      revisions.push(expectedRevision);
      return expectedRevision.endsWith(":1")
        ? Promise.reject(new Error("revision conflict: metadata moved"))
        : Promise.resolve();
    });
    buffer("move-recover", "disk prose");
    editDocument("move-recover", () => ["local draft"]);
    await flushNote("move-recover");
    expect(documentSaveError("move-recover")).toContain("revision conflict");

    reloadDocumentIfClean("move-recover", "disk prose", "test:move-recover:2");
    await flushNote("move-recover");

    expect(revisions).toEqual(["test:move-recover:1", "test:move-recover:2"]);
    expect(documentSaveError("move-recover")).toBeNull();
    expect(read("move-recover")).toEqual(["local draft"]);
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

describe("tab-leave flush scheduling", () => {
  afterEach(() => {
    setWriteNoteBodyForTests(null);
  });

  test("does not start the write in the tab-close commit", () => {
    const writes: string[] = [];
    const afterPaint: Array<() => void> = [];
    setWriteNoteBodyForTests((_id, body) => {
      writes.push(body);
      return Promise.resolve();
    });
    buffer("close-fast", "before");
    editDocument("close-fast", () => ["after"]);

    flushNoteAfterPaint("close-fast", (task) => {
      afterPaint.push(task);
    });
    expect(writes).toEqual([]);

    afterPaint[0]?.();
    expect(writes).toEqual(["after"]);
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

describe("conflicts resolve themselves (2026-09-03)", () => {
  const base = "# Plan\n\n- [ ] buy milk\n\nNotes.";

  test("a disk change on other lines folds into a dirty buffer and the save rebases on disk", async () => {
    const writes: Array<{ body: string; revision: string; expectedBody: string }> = [];
    setWriteNoteBodyForTests((_id, body, revision, expectedBody) => {
      writes.push({ body, revision, expectedBody });
      return Promise.resolve();
    });
    buffer("fold", base);
    editDocument("fold", (lines) => [...lines, "Typed meanwhile."]);
    // the Tasks view ticked the box on disk while the buffer was dirty
    const disk = base.replace("- [ ] buy milk", "- [x] buy milk");
    reloadDocumentIfClean("fold", disk, "test:fold:2");
    expect(read("fold")).toEqual(["# Plan", "", "- [x] buy milk", "", "Notes.", "Typed meanwhile."]);
    await flushNote("fold");
    expect(writes.at(-1)).toEqual({
      body: `${disk}\nTyped meanwhile.`,
      revision: "test:fold:2",
      expectedBody: disk,
    });
    expect(documentSaveError("fold")).toBeNull();
  });

  test("a revision conflict on save reads disk and merges instead of staying stuck", async () => {
    let attempts = 0;
    const disk = base.replace("Notes.", "Notes.\nAppended by the assistant.");
    setWriteNoteBodyForTests((_id, _body, revision) => {
      attempts += 1;
      if (revision === "test:stuck:1")
        return Promise.reject(new Error("revision conflict: expected a, found b"));
      return Promise.resolve();
    });
    setReadNoteForTests(() =>
      Promise.resolve({
        id: "stuck",
        title: "Plan",
        folderId: "f",
        body: disk,
        revision: "test:stuck:2",
      } as never),
    );
    buffer("stuck", base);
    editDocument("stuck", (lines) => ["# Plan for Monday", ...lines.slice(1)]);
    await flushNote("stuck");
    // the failed save triggered the reconcile; give it a tick, then flush the queued save
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushNote("stuck");
    expect(attempts).toBe(2);
    expect(read("stuck")).toEqual([
      "# Plan for Monday",
      "",
      "- [ ] buy milk",
      "",
      "Notes.",
      "Appended by the assistant.",
    ]);
    expect(documentSaveError("stuck")).toBeNull();
  });

  test("an unresolvable conflict never blocks quit: the edits become a sibling note", async () => {
    const folder = await notesService.createFolder("Conflicts");
    const seeded = await notesService.createNote(folder.id, "# Plan\n\nNotes, theirs.");
    touched.add(seeded.id);
    setWriteNoteBodyForTests(() => Promise.reject(new Error("revision conflict: expected a, found b")));
    setReadNoteForTests(() => notesService.getNote(seeded.id));
    ensureDocument(seeded.id, "# Plan\n\nNotes.", "test:seeded:1");
    editDocument(seeded.id, () => ["# Plan", "", "Notes, mine."]);
    await flushNote(seeded.id);
    expect(documentSaveError(seeded.id)).toContain("revision conflict");

    await flushSyncs(); // must resolve, not throw
    const copies = (await notesService.listNotes(folder.id)).filter((n) => n.id !== seeded.id);
    expect(copies).toHaveLength(1);
    const copy = await notesService.getNote(copies[0]!.id);
    expect(copy?.body.startsWith("# Plan (unsaved edits ")).toBe(true);
    expect(copy?.body).toContain("Notes, mine.");
    // the open note now shows the disk version, clean
    expect(read(seeded.id)).toEqual(["# Plan", "", "Notes, theirs."]);
    expect(documentSaveError(seeded.id)).toBeNull();
  });
});
