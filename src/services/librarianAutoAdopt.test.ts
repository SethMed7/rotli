// adoptPendingAtOrganize (2026-09-27, the test-suite audit's top gap): at the
// Organize rung, waiting metadata suggestions apply in the background through
// the approve lane; filing guesses never do. `mock.module` is process-wide and
// outlives this file, so every mock spreads a SNAPSHOT of the real module and
// afterAll restores it.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { useUiStore } from "../state/ui";
import type { BrainAction } from "./brainJournal";
import * as liveComposition from "./brainJournalComposition";
import * as liveStore from "./brainJournalStore";
import * as liveHooks from "./hooks";

const realComposition = { ...liveComposition };
const realStore = { ...liveStore };
const realHooks = { ...liveHooks };

let journal: BrainAction[] = [];
let approved: string[] = [];
let failing = new Set<string>();
let refreshed = 0;
let onApprove: (row: BrainAction) => void = () => {};

void mock.module("./brainJournalStore", () => ({ ...realStore, readJournal: async () => journal }));
void mock.module("./brainJournalComposition", () => ({
  ...realComposition,
  approveProposal: async (row: BrainAction) => {
    onApprove(row);
    if (failing.has(row.id)) throw new Error("the note changed since");
    approved.push(row.id);
  },
}));
void mock.module("./hooks", () => ({
  ...realHooks,
  invalidateNotes: async () => {
    refreshed += 1;
  },
  invalidateJournal: async () => {},
}));

afterAll(() => {
  void mock.module("./brainJournalStore", () => realStore);
  void mock.module("./brainJournalComposition", () => realComposition);
  void mock.module("./hooks", () => realHooks);
});

const { adoptPendingAtOrganize } = await import("./librarianAutoAdopt");

const row = (id: string, action: BrainAction["action"], ts: number): BrainAction =>
  ({
    id,
    ts,
    action,
    noteId: `wiki/${id}.md`,
    noteTitle: id,
    status: "proposed",
    model: "local",
  }) as BrainAction;

beforeEach(() => {
  journal = [row("tags", "field", 3), row("index", "index", 2), row("guess", "file", 1)];
  approved = [];
  failing = new Set();
  refreshed = 0;
  onApprove = () => {};
  useUiStore.setState({ brainEnabled: true, organizerTrust: "organize" });
});

describe("the Librarian adopts waiting suggestions at Organize", () => {
  test("metadata and index rows apply; a filing guess keeps waiting", async () => {
    await adoptPendingAtOrganize();
    expect(approved.sort()).toEqual(["index", "tags"]);
    expect(refreshed).toBe(1);
  });

  test("below Organize, or with the Librarian off, nothing applies", async () => {
    useUiStore.setState({ organizerTrust: "suggest" });
    await adoptPendingAtOrganize();
    useUiStore.setState({ organizerTrust: "organize", brainEnabled: false });
    await adoptPendingAtOrganize();
    expect(approved).toEqual([]);
    expect(refreshed).toBe(0);
  });

  test("dropping out of Organize mid-batch stops at once", async () => {
    onApprove = () => useUiStore.setState({ organizerTrust: "tidy" });
    await adoptPendingAtOrganize();
    expect(approved).toHaveLength(1);
  });

  test("a row whose note changed is left alone and the rest still apply", async () => {
    failing = new Set(["tags"]);
    await adoptPendingAtOrganize();
    expect(approved).toEqual(["index"]);
    expect(refreshed).toBe(1);
  });

  test("nothing applied means nothing refreshed", async () => {
    journal = [row("guess", "file", 1)];
    await adoptPendingAtOrganize();
    expect(refreshed).toBe(0);
  });

  test("a second call while one runs does nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    onApprove = () => {
      calls += 1;
    };
    const first = adoptPendingAtOrganize();
    const second = adoptPendingAtOrganize();
    release();
    await Promise.all([first, second, gate]);
    expect(calls).toBe(2); // the two adoptable rows, once each
  });
});
