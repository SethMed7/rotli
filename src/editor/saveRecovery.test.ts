// The ways a save could still lose words or hold quit forever (sixth and
// seventh reviews of pull request 267), as plain tests against the fake that
// follows Rust's write contract (writeLane.fixtures.ts), with the writes and
// copies it makes held or released by the test. Every order of these events
// is searched by the save-state explorer (saveExplorer.test.ts); the orders
// that once lost words are replayed in saveSchedules.test.ts. What stays here
// is what a person sees: the note's words, its message, and quit's answer,
// asserted before anything held is released.
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
import { resetSaveQueueForTests } from "./saveQueue";
import { documentSaveError, isDirty } from "./saveStatus";
import { outcome, settle, until, within } from "./saveTest.fixtures";
import { fakeLane } from "./writeLane.fixtures";

let lanes = 0;
/** A note on the fake lane, open in the editor. Writes and copies can be held. */
function opened(body: string, policy?: { secure?: boolean; locked?: boolean }) {
  lanes += 1;
  const lane = fakeLane(`recovery${lanes}`);
  const created = lane.create("Inbox", body, policy);
  const held = { writes: false, creates: false };
  const waiting = { writes: [] as (() => void)[], creates: [] as (() => void)[] };
  let writes = 0;
  const gate = (kind: "writes" | "creates") =>
    held[kind] ? new Promise<void>((resolve) => waiting[kind].push(resolve)) : Promise.resolve();
  setWriteNoteBodyForTests(async (id, text, revision, base) => {
    writes += 1;
    await gate("writes");
    return lane.write(id, text, revision, base); // Rust's check, when the write lands
  });
  setReadNoteForTests(async (id) => lane.read(id));
  setCreateNoteForTests(async (folder, text, protection) => {
    await gate("creates");
    return lane.create(folder, text, protection);
  });
  ensureDocument(created.id, created.body, created.revision, created);
  open.push(created.id);
  return {
    lane,
    id: created.id,
    bodies: () => [...lane.files.values()].map((file) => file.body),
    writesStarted: () => writes,
    hold: (kind: "writes" | "creates") => {
      held[kind] = true;
    },
    waiting: (kind: "writes" | "creates") => waiting[kind].length,
    release: async (kind: "writes" | "creates") => {
      held[kind] = false;
      while (waiting[kind].length) waiting[kind].shift()?.();
      await settle();
    },
  };
}

let open: string[] = [];
afterEach(async () => {
  await settle();
  for (const id of open) evictDocument(id);
  open = [];
  resetSaveQueueForTests();
  setWriteNoteBodyForTests(null);
  setReadNoteForTests(null);
  setCreateNoteForTests(null);
  setWriteLimitForTests(null);
});

test("F1: words typed while the conflict copy is being made are kept, and quit waits for them", async () => {
  const t = opened("# Plan\n\nbase");
  setDocumentText(t.id, "# Plan\n\nmine A");
  t.lane.external(t.id, "# Plan\n\noutside"); // another app, same line: no merge
  t.hold("creates");
  let acknowledged = false;
  const quit = outcome(flushSyncs().then(() => (acknowledged = true)));
  await until(() => t.waiting("creates") === 1);
  setDocumentText(t.id, "# Plan\n\nmine A plus B"); // typed while the copy is made
  await settle();
  expect(acknowledged).toBe(false); // nothing is acknowledged while the copy is out
  await t.release("creates");
  await within(quit, 3000);
  if (!acknowledged) expect(await outcome(flushSyncs())).toBe("done");
  const copies = t.bodies().filter((body) => body.includes("unsaved edits"));
  expect(copies).toHaveLength(1); // one copy for one conflict, holding the newest words
  expect(copies[0]).toContain("mine A plus B");
  expect(t.lane.read(t.id)!.body).toBe("# Plan\n\noutside");
  expect(isDirty(t.id)).toBe(false);
});

test("a write that never settles: the note says so by name, keeps its words, and quit refuses before anything lands", async () => {
  setWriteLimitForTests(40);
  const t = opened("# Plan\n\nfirst");
  t.hold("writes");
  setDocumentText(t.id, "# Plan\n\nnew words");
  const quit = await within(outcome(flushSyncs(200)), 2000);
  // the bound fired, quit refused, and the write is still held
  expect(t.waiting("writes")).toBe(1);
  expect(quit).toContain("“Plan” is still waiting on the disk");
  expect(documentSaveError(t.id)).toContain("“Plan” is taking longer than expected to save");
  expect(isDirty(t.id)).toBe(true);
  expect(unsavedDrafts().map((draft) => draft.body)).toContain("# Plan\n\nnew words");
  // typing more starts nothing beside the write that is still out
  setDocumentText(t.id, "# Plan\n\nnew words and more");
  expect(await within(outcome(flushSyncs(200)), 2000)).toContain("“Plan” is still waiting on the disk");
  expect(t.writesStarted()).toBe(1);
  await t.release("writes");
  expect(await within(outcome(flushSyncs()), 2000)).toBe("done");
  expect(t.lane.read(t.id)!.body).toBe("# Plan\n\nnew words and more");
  expect(documentSaveError(t.id)).toBeNull();
});

test("F3: a note purged while it has unsaved words: plain words, quit names it, and keeping makes a protected, locked note", async () => {
  const t = opened("# Ledger\n\nfirst", { secure: true, locked: true });
  setDocumentText(t.id, "# Ledger\n\nwords nobody saved");
  t.lane.purge(t.id);
  await flushNote(t.id).catch(() => {});
  expect(documentSaveError(t.id)).toContain("deleted");
  expect(await outcome(flushSyncs())).toContain("Ledger");
  const kept = await keepGoneNote(t.id);
  const file = kept ? t.lane.files.get(kept) : undefined;
  expect(file?.body).toBe("# Ledger\n\nwords nobody saved");
  expect(file?.meta).toEqual(expect.arrayContaining(["secure: true", "locked: true"]));
  expect(await outcome(flushSyncs())).toBe("done");
});

test("F3: discarding the words lets quit complete", async () => {
  const t = opened("# Plan\n\nfirst");
  setDocumentText(t.id, "# Plan\n\nthrow away");
  t.lane.purge(t.id);
  await flushNote(t.id).catch(() => {});
  expect(await outcome(flushSyncs())).toContain("Plan");
  discardGoneNote(t.id);
  expect(await outcome(flushSyncs())).toBe("done");
  expect(t.bodies()).toEqual([]);
});
