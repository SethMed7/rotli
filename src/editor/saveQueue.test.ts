// A note's save queue (fifth review of pull request 267): overlapping saves
// lost the newest typing. Start saving version A, type version B and save
// again before A finished: both writes carried the same base revision, A
// cleared the dirty flag, B failed as a revision conflict, and nothing said
// the buffer was unsaved, so quit went ahead. The same sequence loses typing
// in the released 1.9.1 and 1.8.0. These tests run against a fake disk that,
// like Rust's write lane, refuses a write whose base revision isn't the
// current one, checked when the write lands.
import { afterEach, describe, expect, test } from "bun:test";

import type { Note } from "../types";
import { flushNoteAfterPaint } from "./flushAfterPaint";
import {
  ensureDocument,
  evictDocument,
  flushNote,
  flushSyncs,
  getDocumentText,
  setDocumentText,
  setReadNoteForTests,
  setWriteNoteBodyForTests,
  unsavedDrafts,
} from "./model";
import { documentSaveError, isDirty } from "./saveStatus";

const ID = "save-queue";

/** The note on disk, and the write lane in front of it. `hold()` keeps each
 * write from landing until `releaseNext()` (or `release()`) lets it. */
function fakeDisk(initial = "old", latencyMs = 0) {
  const disk = { body: initial, revision: "r0", count: 0 };
  const bases: string[] = [];
  const waiting: (() => void)[] = [];
  let holding = false;
  let fail: ((body: string) => Error | null) | null = null;
  const note = (body: string): Note => ({
    id: ID,
    title: body.split("\n")[0] ?? "",
    snippet: "",
    folderId: "Inbox",
    createdAt: 0,
    updatedAt: 1,
    pinned: false,
    body,
    revision: disk.revision,
  });
  setWriteNoteBodyForTests(async (_id, body, expectedRevision) => {
    bases.push(expectedRevision);
    if (holding) await new Promise<void>((resolve) => waiting.push(resolve));
    if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const failure = fail?.(body);
    if (failure) throw failure;
    if (expectedRevision !== disk.revision)
      throw new Error(`revision conflict: expected ${expectedRevision}; found ${disk.revision}`);
    disk.body = body;
    disk.count += 1;
    disk.revision = `r${disk.count}`;
    return note(body);
  });
  setReadNoteForTests(async () => note(disk.body));
  ensureDocument(ID, initial, "r0");
  return {
    disk,
    bases,
    hold: () => {
      holding = true;
    },
    releaseNext: async () => {
      waiting.shift()?.();
      await settle();
    },
    release: async () => {
      holding = false;
      while (waiting.length) waiting.shift()?.();
      await settle();
    },
    failWith: (rule: (body: string) => Error | null) => {
      fail = rule;
    },
    /** Another app writes the file. */
    external: (body: string) => {
      disk.body = body;
      disk.count += 1;
      disk.revision = `r${disk.count}`;
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms))]);

afterEach(() => {
  evictDocument(ID);
  setWriteNoteBodyForTests(null);
  setReadNoteForTests(null);
});

describe("one write at a time per note", () => {
  test("the reviewer's sequence: hold A, type B, save, release A: B lands on A's revision", async () => {
    const disk = fakeDisk();
    disk.hold();
    setDocumentText(ID, "first");
    const first = flushNote(ID).catch(() => {});
    setDocumentText(ID, "last keystrokes");
    const second = flushNote(ID).catch(() => {});
    await settle();
    expect(disk.bases).toEqual(["r0"]); // B waits; it never goes out on A's base
    await disk.release();
    await Promise.all([first, second]);
    expect(disk.disk.body).toBe("last keystrokes");
    expect(disk.bases).toEqual(["r0", "r1"]);
    expect(isDirty(ID)).toBe(false);
    expect(documentSaveError(ID)).toBeNull();
  });

  test("the same through closing the tab: the newest text lands", async () => {
    const disk = fakeDisk();
    disk.hold();
    setDocumentText(ID, "first");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "last keystrokes");
    flushNoteAfterPaint(ID, (task) => task()); // the tab closes
    await disk.release();
    await settle();
    expect(disk.disk.body).toBe("last keystrokes");
    expect(isDirty(ID)).toBe(false);
  });

  test("the same through quit: quit waits, and the newest text lands", async () => {
    const disk = fakeDisk();
    disk.hold();
    setDocumentText(ID, "first");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "last keystrokes");
    const quit = flushSyncs();
    await settle();
    await disk.release();
    await quit;
    expect(disk.disk.body).toBe("last keystrokes");
    expect(unsavedDrafts()).toEqual([]);
  });

  test("three overlapping saves: one more write after the first, with the newest text", async () => {
    const disk = fakeDisk();
    disk.hold();
    setDocumentText(ID, "A");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "B");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "C");
    const last = flushNote(ID);
    await disk.release();
    await last;
    expect(disk.disk.body).toBe("C");
    expect(disk.bases).toEqual(["r0", "r1"]);
  });
});

describe("dirty is derived from what last landed", () => {
  test("a failed middle save stays dirty, in the recovery journal, with its error, and blocks quit", async () => {
    const disk = fakeDisk();
    disk.hold();
    disk.failWith((body) => (body === "B" ? new Error("The disk is full.") : null));
    setDocumentText(ID, "A");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "B");
    const second = flushNote(ID).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await disk.release();
    expect(await second).toBe("The disk is full.");
    expect(disk.disk.body).toBe("A");
    expect(isDirty(ID)).toBe(true);
    expect(documentSaveError(ID)).toBe("The disk is full.");
    expect(unsavedDrafts().map((draft) => [draft.noteId, draft.body])).toEqual([[ID, "B"]]);
    await expect(flushSyncs()).rejects.toThrow(/unsaved edits/);
    // the disk recovers: the retry lands it
    disk.failWith(() => null);
    await flushSyncs();
    expect(disk.disk.body).toBe("B");
    expect(isDirty(ID)).toBe(false);
  });

  test("typing during every save: a flush refuses (still saving), it never claims the note is saved", async () => {
    const disk = fakeDisk();
    let typed = 0;
    disk.failWith(() => {
      typed += 1;
      setDocumentText(ID, `typing ${typed}`);
      return null;
    });
    setDocumentText(ID, "first");
    const flushed = await within(
      flushNote(ID).then(
        () => "resolved",
        (error: Error) => error.message,
      ),
      2000,
    );
    expect(flushed).toBe("Still saving. Try again in a moment.");
    expect(isDirty(ID)).toBe(true);
  });

  test("a write that never settles: a bounded refusal, and the save isn't cancelled", async () => {
    const disk = fakeDisk();
    disk.hold();
    setDocumentText(ID, "new words");
    const flushed = await within(
      flushNote(ID, 50).then(
        () => "resolved",
        (error: Error) => error.message,
      ),
      1000,
    );
    expect(flushed).toBe("Still saving. Try again in a moment.");
    expect(isDirty(ID)).toBe(true);
    await disk.release();
    expect(disk.disk.body).toBe("new words");
    expect(isDirty(ID)).toBe(false);
  });

  test("another app changes the file during the queue: both edits survive", async () => {
    const disk = fakeDisk("one\ntwo\nthree");
    disk.hold();
    setDocumentText(ID, "one!\ntwo\nthree");
    void flushNote(ID).catch(() => {});
    setDocumentText(ID, "one!!\ntwo\nthree");
    void flushNote(ID).catch(() => {});
    await disk.releaseNext(); // A lands; B goes out on A's revision, held
    disk.external("one!\ntwo\nthree, edited elsewhere");
    await disk.release(); // B conflicts with the outside edit: merged, saved again
    await flushNote(ID).catch(() => {});
    await settle();
    await flushNote(ID).catch(() => {});
    expect(disk.disk.body).toBe("one!!\ntwo\nthree, edited elsewhere");
    expect(getDocumentText(ID)).toBe("one!!\ntwo\nthree, edited elsewhere");
    expect(isDirty(ID)).toBe(false);
  });
});

// Someone who never uses AI: type, pause long enough for the autosave to go
// out, keep typing, and switch away or quit while that save is still on its
// way. Every keystroke must be on disk.
test("type, pause, type, quit: every keystroke is on disk", async () => {
  const disk = fakeDisk("", 120); // a save takes a moment to land
  setDocumentText(ID, "Hello");
  await new Promise((resolve) => setTimeout(resolve, 430)); // the autosave went out
  setDocumentText(ID, "Hello world"); // typed while it was on its way
  const quit = flushSyncs(); // quit (or switching away) before it landed
  await quit;
  expect(disk.disk.body).toBe("Hello world");
  expect(isDirty(ID)).toBe(false);
});
