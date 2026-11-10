// Sixth review of pull request 267: the ways a save could still lose words or
// hold quit forever. Each runs against the test fake that follows Rust's write
// contract (writeLane.fixtures.ts), with the writes and copies it makes held
// or released by the test.
import { afterEach, expect, test } from "bun:test";

import {
  discardGoneNote,
  ensureDocument,
  evictDocument,
  flushNote,
  flushSyncs,
  keepGoneNote,
  setCreateNoteForTests,
  setDocumentText,
  setReadNoteForTests,
  setWriteLimitForTests,
  setWriteNoteBodyForTests,
  unsavedDrafts,
} from "./model";
import { documentSaveError, isDirty } from "./saveStatus";
import { outcome, settle, until, within } from "./saveTest.fixtures";
import { fakeLane } from "./writeLane.fixtures";

/** A note on the fake lane, open in the editor. Writes and copies can be held. */
function opened(body: string, policy?: { secure?: boolean }) {
  const lane = fakeLane();
  const created = lane.create("Inbox", body, policy);
  const held = { writes: false, creates: false };
  const waiting = { writes: [] as (() => void)[], creates: [] as (() => void)[] };
  const gate = (kind: "writes" | "creates") =>
    held[kind] ? new Promise<void>((resolve) => waiting[kind].push(resolve)) : Promise.resolve();
  setWriteNoteBodyForTests(async (id, text, revision, base) => {
    await gate("writes");
    return lane.write(id, text, revision, base); // Rust's check, when the write lands
  });
  setReadNoteForTests(async (id) => lane.read(id));
  setCreateNoteForTests(async (folder, text, protection) => {
    await gate("creates");
    return lane.create(folder, text, protection);
  });
  ensureDocument(created.id, created.body, created.revision, created);
  return {
    lane,
    id: created.id,
    bodies: () => [...lane.files.values()].map((file) => file.body),
    hold: (kind: "writes" | "creates") => {
      held[kind] = true;
    },
    waiting: (kind: "writes" | "creates") => waiting[kind].length,
    /** Let the oldest held call through (later ones stay held). */
    releaseFirst: async (kind: "writes" | "creates") => {
      waiting[kind].shift()?.();
      await settle();
    },
    /** Let the newest held call through (earlier ones stay held). */
    releaseLast: async (kind: "writes" | "creates") => {
      waiting[kind].pop()?.();
      await settle();
    },
    release: async (kind: "writes" | "creates") => {
      held[kind] = false;
      while (waiting[kind].length) waiting[kind].shift()?.();
      await settle();
    },
  };
}

let open: string[] = [];
const note = (body: string, policy?: { secure?: boolean }) => {
  const made = opened(body, policy);
  open.push(made.id);
  return made;
};
afterEach(async () => {
  await settle();
  for (const id of open) evictDocument(id);
  open = [];
  setWriteNoteBodyForTests(null);
  setReadNoteForTests(null);
  setCreateNoteForTests(null);
  setWriteLimitForTests(null);
});

test("F1: words typed while the conflict copy is being made are kept, and quit waits for them", async () => {
  const t = note("# Plan\n\nbase");
  setDocumentText(t.id, "# Plan\n\nmine A");
  t.lane.external(t.id, "# Plan\n\noutside"); // another app, same line: no merge
  t.hold("creates");
  const quit = outcome(flushSyncs());
  await until(() => t.waiting("creates") === 1);
  setDocumentText(t.id, "# Plan\n\nmine A plus B"); // typed while the copy is made
  await t.release("creates");
  const result = await within(quit, 3000);
  expect(t.bodies().some((body) => body.includes("plus B"))).toBe(true);
  expect(t.bodies()).toContain("# Plan\n\noutside");
  if (result === "done") expect(isDirty(t.id)).toBe(false);
});

test("F2: a write that never settles: the note names itself, keeps its draft, and quit refuses in time", async () => {
  setWriteLimitForTests(40);
  const t = note("# Plan\n\nfirst");
  t.hold("writes");
  setDocumentText(t.id, "# Plan\n\nnew words");
  const quit = await within(outcome(flushSyncs()), 2000);
  expect(quit).not.toBe("timed out");
  expect(quit).toContain("Plan");
  expect(documentSaveError(t.id)).toContain("Plan");
  expect(isDirty(t.id)).toBe(true);
  expect(unsavedDrafts().map((draft) => draft.body)).toContain("# Plan\n\nnew words");
  await t.release("writes");
});

test("F2: the stalled write lands before the retry: the retry reads the disk and sees it", async () => {
  setWriteLimitForTests(40);
  const t = note("# Plan\n\nfirst");
  t.hold("writes");
  setDocumentText(t.id, "# Plan\n\nnew words");
  expect(await outcome(flushNote(t.id, 500))).not.toBe("done");
  t.hold("writes");
  await t.releaseFirst("writes"); // the stalled write arrives late
  await within(outcome(flushSyncs()), 2000);
  await t.release("writes");
  await flushSyncs();
  expect(t.bodies()).toEqual(["# Plan\n\nnew words"]); // no conflict copy
  expect(isDirty(t.id)).toBe(false);
  expect(documentSaveError(t.id)).toBeNull();
});

/** A write of "# Plan\n\nchanged" stalls; the person then types `newest`; the
 * retry goes out; the two land in `order`. */
async function stalledThenRetried(newest: string, order: "retry first" | "stalled first") {
  setWriteLimitForTests(40);
  const t = note("# Plan\n\nfirst");
  t.hold("writes");
  setDocumentText(t.id, "# Plan\n\nchanged");
  await within(outcome(flushSyncs()), 2000); // the write stalls
  expect(t.waiting("writes")).toBe(1);
  setDocumentText(t.id, newest);
  const retry = outcome(flushSyncs());
  await until(() => t.waiting("writes") === 2); // the retry read the disk and went out
  if (order === "retry first") await t.releaseLast("writes");
  else await t.releaseFirst("writes");
  await t.release("writes");
  await within(retry, 2000);
  await within(outcome(flushSyncs()), 2000);
  expect(t.lane.read(t.id)!.body).toBe(newest);
  expect(t.bodies()).toEqual([newest]); // no conflict copy of the person's own words
  expect(isDirty(t.id)).toBe(false);
  expect(documentSaveError(t.id)).toBeNull();
}

test("F2: the retry lands first with newer words; the stalled write arrives after and Rust refuses it", () =>
  stalledThenRetried("# Plan\n\nchanged and more", "retry first"));

test("F2: the retry lands first having restored the saved words; Rust accepts the stalled write, so Rotli writes the newest again", () =>
  stalledThenRetried("# Plan\n\nfirst", "retry first"));

test("F2: the stalled write lands between the retry's read and its write: it's Rotli's own, never merged in as someone else's", () =>
  stalledThenRetried("# Plan\n\nfirst", "stalled first"));

test("F3: a note purged while it has unsaved words: plain words, quit names it, and keeping makes a protected note", async () => {
  const t = note("# Ledger\n\nfirst", { secure: true });
  setDocumentText(t.id, "# Ledger\n\nwords nobody saved");
  t.lane.purge(t.id);
  await flushNote(t.id).catch(() => {});
  expect(documentSaveError(t.id)).toContain("deleted");
  expect(await outcome(flushSyncs())).toContain("Ledger");
  await keepGoneNote(t.id);
  const kept = [...t.lane.files.values()].find((file) => file.body.includes("words nobody saved"));
  expect(kept?.meta).toContain("secure: true");
  expect(await outcome(flushSyncs())).toBe("done");
});

test("F3: discarding the words lets quit complete", async () => {
  const t = note("# Plan\n\nfirst");
  setDocumentText(t.id, "# Plan\n\nthrow away");
  t.lane.purge(t.id);
  await flushNote(t.id).catch(() => {});
  expect(await outcome(flushSyncs())).toContain("Plan");
  discardGoneNote(t.id);
  expect(await outcome(flushSyncs())).toBe("done");
  expect(t.bodies()).toEqual([]);
});
