// Scoped invalidation locks (perf audit 2026-07-30, #1): the editor's 400ms
// sync must NOT refetch the notes universe — applyNoteWrite patches the fresh
// note straight into the caches. The load-bearing assertions: steady mid-body
// typing leaves every LIST identity untouched (so useNoteIndex/TabStrip don't
// re-derive per tick), while a visible row change (title) patches + re-sorts.

import { afterEach, describe, expect, test } from "bun:test";

import type { Note, NoteSummary } from "../types";
import { UNIVERSE_KEY, applyNoteWrite, keys } from "./hooks";
import { queryClient } from "./query";

const NOW = 1_800_000_000_000;

function summary(id: string, over: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id,
    title: `Title ${id}`,
    snippet: `Snippet ${id}`,
    folderId: "Inbox",
    createdAt: NOW - 100_000,
    updatedAt: NOW - 100_000,
    pinned: false,
    ...over,
  };
}

function note(id: string, over: Partial<Note> = {}): Note {
  return { ...summary(id), body: `# Title ${id}\n\nSnippet ${id}`, ...over };
}

afterEach(() => {
  queryClient.clear();
});

describe("applyNoteWrite", () => {
  test("mid-body typing (row-invisible change) leaves every list identity untouched", async () => {
    const list = [summary("a"), summary("b")];
    queryClient.setQueryData(keys.notes(undefined), list);
    queryClient.setQueryData(keys.notes("Inbox"), list);
    // same title/snippet/pin, updatedAt drifted only 5s — not a visible row change
    await applyNoteWrite(note("a", { updatedAt: NOW - 95_000, body: "# Title a\n\nSnippet a\nmore" }));
    expect(queryClient.getQueryData<NoteSummary[]>(keys.notes(undefined))).toBe(list);
    expect(queryClient.getQueryData<NoteSummary[]>(keys.notes("Inbox"))).toBe(list);
    // the note cache itself DID take the fresh body
    expect(queryClient.getQueryData<Note>(keys.note("a"))!.body).toContain("more");
  });

  test("a title change patches every containing list and re-sorts by the list order", async () => {
    queryClient.setQueryData(keys.notes(undefined), [
      summary("a", { updatedAt: NOW - 500_000 }),
      summary("b", { updatedAt: NOW - 100_000 }),
    ]);
    await applyNoteWrite(note("a", { title: "Renamed", updatedAt: NOW }));
    const patched = queryClient.getQueryData<NoteSummary[]>(keys.notes(undefined))!;
    expect(patched[0]).toMatchObject({ id: "a", title: "Renamed", updatedAt: NOW });
    expect(patched[1]!.id).toBe("b");
  });

  test("lists that don't contain the note are never touched", async () => {
    const other = [summary("x")];
    queryClient.setQueryData(keys.notes("Storage"), other);
    queryClient.setQueryData(keys.notes(undefined), [summary("a")]);
    await applyNoteWrite(note("a", { title: "Renamed", updatedAt: NOW }));
    expect(queryClient.getQueryData<NoteSummary[]>(keys.notes("Storage"))).toBe(other);
  });

  test("the note universe's single whole-corpus entry stays fresh with no extra wiring", async () => {
    // useNoteUniverse now fetches the whole corpus ONCE under a reserved folderId
    // sentinel, keyed inside ["notes"] — so applyNoteWrite patches it exactly like
    // any per-folder list, keeping the Main index / tab titles live mid-type.
    const flat = [summary("a", { updatedAt: NOW - 500_000 }), summary("b", { updatedAt: NOW - 100_000 })];
    queryClient.setQueryData(keys.notes(UNIVERSE_KEY), flat);
    // a row-invisible body edit leaves the whole-corpus entry identity untouched
    await applyNoteWrite(note("a", { updatedAt: NOW - 495_000, body: "# Title a\n\nSnippet a\nmore" }));
    expect(queryClient.getQueryData<NoteSummary[]>(keys.notes(UNIVERSE_KEY))).toBe(flat);
    // a title change patches the note in place inside the single entry
    await applyNoteWrite(note("a", { title: "Renamed", updatedAt: NOW }));
    const patched = queryClient.getQueryData<NoteSummary[]>(keys.notes(UNIVERSE_KEY))!;
    expect(patched.find((n) => n.id === "a")).toMatchObject({ title: "Renamed", updatedAt: NOW });
  });

  test("tasksChanged invalidates ONLY the tasks projection", async () => {
    queryClient.setQueryData(keys.tasks, []);
    queryClient.setQueryData(keys.notes(undefined), [summary("a")]);
    await applyNoteWrite(note("a"), { tasksChanged: true });
    expect(queryClient.getQueryState(keys.tasks)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(keys.notes(undefined))?.isInvalidated).toBe(false);
  });
});
