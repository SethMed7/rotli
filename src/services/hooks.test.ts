// Scoped invalidation locks (perf audit 2026-07-30, #1): the editor's 400ms
// sync must NOT refetch the notes universe — applyNoteWrite patches the fresh
// note straight into the caches. The load-bearing assertions: steady mid-body
// typing leaves every LIST identity untouched (so useNoteIndex/TabStrip don't
// re-derive per tick), while a visible row change (title) patches + re-sorts.

import { afterEach, describe, expect, test } from "bun:test";

import { QueryObserver } from "@tanstack/react-query";

import type { Note, NoteSummary } from "../types";
import { UNIVERSE_KEY, applyNoteWrite, invalidateNoteLists, keys } from "./hooks";
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
  return { ...summary(id), body: `# Title ${id}\n\nSnippet ${id}`, revision: `test:${id}`, ...over };
}

afterEach(() => {
  queryClient.clear();
});

describe("applyNoteWrite", () => {
  test("a save marks the Links projection stale only when what the note links to changed", async () => {
    queryClient.setQueryData(keys.links, []);
    const stale = () => queryClient.getQueryState(keys.links)?.isInvalidated === true;
    queryClient.setQueryData(keys.note("a"), note("a", { body: "# Title a\n\nSee [[B]]." }));
    // typing that leaves the links alone keeps the projection fresh
    await applyNoteWrite(note("a", { body: "# Title a\n\nSee [[B]]. More words." }));
    expect(stale()).toBe(false);
    // a new link marks it stale for its next reader, with no walk now
    await applyNoteWrite(note("a", { body: "# Title a\n\nSee [[B]] and [[C]]." }));
    expect(stale()).toBe(true);
  });

  test("a save that puts a secret in a note refetches Links for an open Graph or canvas now", async () => {
    let fetches = 0;
    queryClient.setQueryData(keys.links, []);
    const open = new QueryObserver(queryClient, {
      queryKey: keys.links,
      queryFn: async () => {
        fetches += 1;
        return [];
      },
      staleTime: Infinity,
    });
    const stop = open.subscribe(() => {});
    queryClient.setQueryData(keys.note("s"), note("s", { body: "# Card\n\nPay day." }));
    await applyNoteWrite(note("s", { body: "# Card\n\nPay day: 4111 1111 1111 1111" }));
    await Promise.resolve();
    expect(fetches).toBe(1);
    // and again when the secret leaves, so the card can open back up
    await applyNoteWrite(note("s", { body: "# Card\n\nPay day." }));
    await Promise.resolve();
    expect(fetches).toBe(2);
    stop();
  });

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

describe("invalidateNoteLists", () => {
  afterEach(() => queryClient.clear());

  test("a new item refetches the listings only — open bodies and the Tasks projection stay fresh", async () => {
    queryClient.setQueryData(keys.notes(undefined), []);
    queryClient.setQueryData(keys.notes(UNIVERSE_KEY), []);
    queryClient.setQueryData(keys.note("open-tab"), { id: "open-tab" });
    queryClient.setQueryData(keys.tasks, []);
    await invalidateNoteLists();
    expect(queryClient.getQueryState(keys.notes(undefined))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(keys.notes(UNIVERSE_KEY))?.isInvalidated).toBe(true);
    // Command-T used to refetch every open tab's body and re-walk tasks for a
    // blank note nobody had typed into (2026-09-01)
    expect(queryClient.getQueryState(keys.note("open-tab"))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(keys.tasks)?.isInvalidated).toBe(false);
  });
});
