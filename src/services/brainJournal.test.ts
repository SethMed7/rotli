// deriveJournal grammar locks — the ONE fold every consumer (Activity pane,
// sidebar badge) shares. The journal is append-only jsonl with TWO writers
// (the TS commands + the Rust daemon); a same-id re-append is a status
// transition and the LAST line must win. The second half locks the TRANSITION
// grammar itself (approve/dismiss/undo re-append the proposal's OWN id) via
// the injectable deps seam — no Tauri shell needed.

import { describe, expect, test } from "bun:test";
import type { CorpusNoteMeta, FrontmatterView } from "../lib/tauri";
import {
  type BrainAction,
  type JournalDeps,
  approveProposal,
  canUndo,
  deriveJournal,
  describeAction,
  dismissProposal,
  undoAction,
} from "./brainJournal";

const row = (over: Partial<BrainAction>): BrainAction => ({
  id: "a1",
  ts: 1,
  action: "file",
  noteId: "wiki/_inbox/foo-a1b2c3.md",
  noteTitle: "Foo",
  area: "Projects",
  before: "wiki/_inbox",
  after: "wiki/Projects",
  status: "proposed",
  ...over,
});

describe("deriveJournal — last line per id wins", () => {
  test("a lone proposal is pending, not history", () => {
    const v = deriveJournal([row({})]);
    expect(v.pending.map((a) => a.id)).toEqual(["a1"]);
    expect(v.history).toEqual([]);
  });

  test("proposed → applied resolves out of pending into history", () => {
    const v = deriveJournal([row({}), row({ ts: 2, status: "applied" })]);
    expect(v.pending).toEqual([]);
    expect(v.history.map((a) => a.status)).toEqual(["applied"]);
  });

  test("proposed → dismissed disappears from both lanes", () => {
    const v = deriveJournal([row({}), row({ ts: 2, status: "dismissed" })]);
    expect(v.pending).toEqual([]);
    expect(v.history).toEqual([]);
  });

  test("applied → reverted stays in history as the undone marker", () => {
    const v = deriveJournal([row({ status: "applied" }), row({ ts: 2, status: "reverted" })]);
    expect(v.pending).toEqual([]);
    expect(v.history.map((a) => a.status)).toEqual(["reverted"]);
  });

  test("orders both lanes newest first", () => {
    const v = deriveJournal([
      row({ id: "old", ts: 1 }),
      row({ id: "new", ts: 3 }),
      row({ id: "done-old", ts: 2, status: "applied" }),
      row({ id: "done-new", ts: 4, status: "applied" }),
    ]);
    expect(v.pending.map((a) => a.id)).toEqual(["new", "old"]);
    expect(v.history.map((a) => a.id)).toEqual(["done-new", "done-old"]);
  });

  test("daemon ULID ids and TS ts36-counter36 ids coexist without folding", () => {
    const v = deriveJournal([
      row({ id: "01J9XYZABCDEFGHJKMNPQRSTVW", ts: 5 }), // Rust ULID
      row({ id: "mbk3x9-0", ts: 6, status: "applied" }), // TS actionId
    ]);
    expect(v.pending).toHaveLength(1);
    expect(v.history).toHaveLength(1);
  });

  test("tolerates unknown statuses and extra fields (a future writer), no crash", () => {
    const alien = {
      ...row({ id: "z9", ts: 9 }),
      status: "quarantined" as BrainAction["status"],
      gitSha: "deadbeef",
    } as BrainAction;
    const v = deriveJournal([alien, row({ id: "ok", ts: 10 })]);
    expect(v.pending.map((a) => a.id)).toEqual(["ok"]);
    expect(v.history).toEqual([]);
  });

  test("drops rows without a usable id (a torn/foreign line)", () => {
    const broken = { ...row({}), id: "" } as BrainAction;
    const v = deriveJournal([broken, row({ id: "good", ts: 2 })]);
    expect(v.pending.map((a) => a.id)).toEqual(["good"]);
  });

  test("daemon index rows (empty model, no confidence/field) fold like any other", () => {
    const idx = row({
      id: "01JIDX",
      action: "index",
      noteId: "wiki/Projects/_index.md",
      noteTitle: "Projects",
      before: "",
      after: "# Projects\n\n| Note | Summary |\n",
      model: "",
    });
    delete (idx as Partial<BrainAction>).confidence;
    const v = deriveJournal([idx, { ...idx, ts: 2, status: "dismissed" }]);
    expect(v.pending).toEqual([]);
    expect(v.history).toEqual([]);
  });
});

// ─── the transition grammar (approve / dismiss / undo) ──────────────────────

interface Calls {
  appended: BrainAction[];
  fileNote: [string, string, { journal?: boolean } | undefined][];
  setAiField: [string, string, string][];
  writeIndex: [string, string][];
  filerMove: [string, string][];
  learned: [string, string, string][];
}

/** Fake corpus: the note lives at `rel`, with `fields` frontmatter lines. */
function fakeDeps(rel: string, fields: string[] = [], over: Partial<JournalDeps> = {}) {
  const calls: Calls = {
    appended: [],
    fileNote: [],
    setAiField: [],
    writeIndex: [],
    filerMove: [],
    learned: [],
  };
  const fm: FrontmatterView = {
    id: "01ULID",
    created: "",
    updated: "",
    locked: false,
    secure: false,
    localAiAllowed: false,
    pinned: false,
    fields,
  };
  const deps: JournalDeps = {
    fileNote: async (id, area, opts) => {
      calls.fileNote.push([id, area, opts]);
      return "wiki/Projects/foo-a1b2c3.md";
    },
    setAiField: async (id, key, value) => {
      calls.setAiField.push([id, key, value]);
    },
    writeIndex: async (area, body) => {
      calls.writeIndex.push([area, body]);
    },
    filerMove: async (id, folder) => {
      calls.filerMove.push([id, folder]);
      return {} as CorpusNoteMeta;
    },
    notePath: async () => rel,
    frontmatter: async () => fm,
    append: async (line) => {
      calls.appended.push(JSON.parse(line) as BrainAction);
    },
    readIndex: async () => "", // no overview on disk (a first proposal's `before`)
    learnField: async (note, key, value) => {
      calls.learned.push([note, key, value]);
    },
    ...over,
  };
  return { deps, calls };
}

describe("approveProposal — the same-id transition", () => {
  test("files via the proposal's ULID with journal:false and re-appends its OWN id", async () => {
    const p = row({ id: "01JPROP", noteUlid: "01ULID" });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md");
    await approveProposal(p, deps);
    // journal:false — a fresh logAction row here would double-log the move
    // and leave the proposal stuck pending forever
    expect(calls.fileNote).toEqual([["01ULID", "Projects", { journal: false }]]);
    expect(calls.appended).toHaveLength(1);
    const marker = calls.appended[0];
    expect(marker?.id).toBe("01JPROP");
    expect(marker?.status).toBe("applied");
    expect(marker?.noteId).toBe("wiki/Projects/foo-a1b2c3.md");
    expect(marker?.after).toBe("wiki/Projects");
    // and the fold resolves it out of pending
    const v = deriveJournal([p, ...calls.appended]);
    expect(v.pending).toEqual([]);
    expect(v.history.map((a) => a.id)).toEqual(["01JPROP"]);
  });

  test("refuses a file proposal whose note has MOVED since (stale decision, §4.8)", async () => {
    const p = row({ id: "01JPROP", noteUlid: "01ULID" });
    const { deps, calls } = fakeDeps("wiki/Research/foo-a1b2c3.md"); // already elsewhere
    await expect(approveProposal(p, deps)).rejects.toThrow(/moved since/);
    expect(calls.fileNote).toEqual([]);
    expect(calls.appended).toEqual([]); // still pending — Dismiss is the way out
  });

  test("applies a field proposal at the note's CURRENT rel (survives a sibling filing)", async () => {
    const p = row({
      id: "01JFIELD",
      action: "field",
      field: "summary",
      noteId: "wiki/_inbox/foo-a1b2c3.md", // rel pinned at proposal time
      noteUlid: "01ULID",
      before: "",
      after: "one line",
    });
    // the sibling "file" proposal was approved first — the note moved
    const { deps, calls } = fakeDeps("wiki/Projects/foo-a1b2c3.md");
    await approveProposal(p, deps);
    expect(calls.setAiField).toEqual([["wiki/Projects/foo-a1b2c3.md", "summary", "one line"]]);
    expect(calls.appended[0]?.id).toBe("01JFIELD");
    expect(calls.appended[0]?.noteId).toBe("wiki/Projects/foo-a1b2c3.md");
  });

  test("persists area_confidence beside an approved suggested_area", async () => {
    const p = row({
      id: "01JSUGG",
      action: "field",
      field: "suggested_area",
      noteUlid: "01ULID",
      before: "",
      after: "Research",
      confidence: 0.4,
    });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md");
    await approveProposal(p, deps);
    expect(calls.setAiField).toEqual([
      ["wiki/_inbox/foo-a1b2c3.md", "suggested_area", "Research"],
      ["wiki/_inbox/foo-a1b2c3.md", "area_confidence", "0.40"],
    ]);
  });

  test("refuses a field proposal the user has since edited over (never clobber)", async () => {
    const p = row({
      id: "01JFIELD",
      action: "field",
      field: "summary",
      noteUlid: "01ULID",
      before: "",
      after: "one line",
    });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md", ["summary: my own words"]);
    await expect(approveProposal(p, deps)).rejects.toThrow(/changed since/);
    expect(calls.setAiField).toEqual([]);
    expect(calls.appended).toEqual([]);
    expect(calls.learned).toEqual([]);
  });

  test("an approved filing records filed_by/filed_at like an auto-apply (#90)", async () => {
    const p = row({ id: "01JPROP", noteUlid: "01ULID", model: "gemma-3-12b-it-qat-4bit" });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md");
    await approveProposal(p, deps);
    const keys = calls.setAiField.map(([, k]) => k);
    expect(keys).toEqual(["filed_by", "filed_at"]);
    expect(calls.setAiField[0]?.[2]).toBe("gemma-3-12b-it-qat-4bit");
    expect(calls.setAiField[1]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/); // an ISO stamp
    expect(calls.fileNote).toHaveLength(1); // the move still rides the Filer lane
    // stamped AFTER the move, at the note's NEW home (review, 2026-07)
    expect(calls.setAiField.map(([relArg]) => relArg)).toEqual([
      "wiki/Projects/foo-a1b2c3.md",
      "wiki/Projects/foo-a1b2c3.md",
    ]);
  });

  test("a refused filing stamps NOTHING — no filed_by on an unfiled note (review, 2026-07)", async () => {
    const p = row({ id: "01JPROP", noteUlid: "01ULID", model: "gemma-3-12b-it-qat-4bit" });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md", [], {
      // the filer gate refuses (the user locked the note mid-flight)
      fileNote: async () => {
        throw new Error("the filer may not write a locked note");
      },
    });
    await expect(approveProposal(p, deps)).rejects.toThrow(/locked/);
    expect(calls.setAiField).toEqual([]); // an unfiled note never reads as filed
    expect(calls.appended).toEqual([]); // still pending — retry or Dismiss
  });

  test("a failed stamp does NOT fail an approve whose filing already landed", async () => {
    const p = row({ id: "01JPROP", noteUlid: "01ULID" });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md", [], {
      setAiField: async () => {
        throw new Error("gate refused the stamp");
      },
    });
    await approveProposal(p, deps);
    expect(calls.fileNote).toHaveLength(1);
    expect(calls.appended[0]?.status).toBe("applied"); // the journal transition lands
  });

  test("an approved field teaches the daemon's never-clobber baseline (#28)", async () => {
    const p = row({
      id: "01JFIELD",
      action: "field",
      field: "summary",
      noteUlid: "01ULID",
      before: "",
      after: "one line",
    });
    const { deps, calls } = fakeDeps("wiki/Projects/foo-a1b2c3.md");
    await approveProposal(p, deps);
    expect(calls.learned).toEqual([["01ULID", "summary", "one line"]]);
    // a learn failure must NOT fail the approve — the field write already landed
    const { deps: deps2, calls: calls2 } = fakeDeps("wiki/Projects/foo-a1b2c3.md", [], {
      learnField: async () => {
        throw new Error("daemon busy");
      },
    });
    await approveProposal(p, deps2);
    expect(calls2.appended[0]?.status).toBe("applied");
  });

  test("teaches area_confidence beside an approved suggested_area (#28)", async () => {
    const p = row({
      id: "01JSUGG",
      action: "field",
      field: "suggested_area",
      noteUlid: "01ULID",
      before: "",
      after: "Research",
      confidence: 0.4,
    });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md");
    await approveProposal(p, deps);
    expect(calls.learned).toEqual([
      ["01ULID", "suggested_area", "Research"],
      ["01ULID", "area_confidence", "0.40"],
    ]);
  });

  test("refuses an index proposal whose overview changed since (§4.8, #26)", async () => {
    const p = row({
      id: "01JIDX",
      action: "index",
      area: "Projects",
      noteId: "wiki/Projects/_index.md",
      before: "# Projects\n\n| Note | Summary |\n| --- | --- |\n| Old |  |\n",
      after: "# Projects\n\n| Note | Summary |\n| --- | --- |\n| Old |  |\n| New |  |\n",
    });
    // a sibling approve / filing rewrote the overview since this was proposed
    const { deps, calls } = fakeDeps("wiki/Projects/_index.md", [], {
      readIndex: async () => "# Projects\n\nsomething newer\n",
    });
    await expect(approveProposal(p, deps)).rejects.toThrow(/overview changed/);
    expect(calls.writeIndex).toEqual([]);
    expect(calls.appended).toEqual([]);

    // unchanged on disk → applies verbatim
    const { deps: ok, calls: okCalls } = fakeDeps("wiki/Projects/_index.md", [], {
      readIndex: async () => p.before,
    });
    await approveProposal(p, ok);
    expect(okCalls.writeIndex).toEqual([["Projects", p.after]]);
    expect(okCalls.appended[0]?.status).toBe("applied");
  });
});

describe("dismissProposal / undoAction — same-id re-appends", () => {
  test("dismiss appends the proposal's own id with status dismissed, corpus untouched", async () => {
    const p = row({ id: "01JPROP" });
    const { deps, calls } = fakeDeps("wiki/_inbox/foo-a1b2c3.md");
    await dismissProposal(p, deps);
    expect(calls.appended.map((a) => [a.id, a.status])).toEqual([["01JPROP", "dismissed"]]);
    expect(calls.fileNote).toEqual([]);
    expect(calls.setAiField).toEqual([]);
    expect(deriveJournal([p, ...calls.appended]).pending).toEqual([]);
  });

  test("undo moves back via the ULID and re-appends the id as reverted", async () => {
    const a = row({
      id: "01JDONE",
      status: "applied",
      noteId: "wiki/Projects/foo-a1b2c3.md",
      noteUlid: "01ULID",
    });
    const { deps, calls } = fakeDeps("wiki/Projects/foo-a1b2c3.md");
    await undoAction(a, deps);
    expect(calls.filerMove).toEqual([["01ULID", "wiki/_inbox"]]);
    expect(calls.appended.map((x) => [x.id, x.status])).toEqual([["01JDONE", "reverted"]]);
  });

  test("undo of a FIRST index apply writes the empty before-body (Rust removes the file)", async () => {
    const a = row({
      id: "01JIDX",
      action: "index",
      status: "applied",
      area: "Projects",
      noteId: "wiki/Projects/_index.md",
      before: "",
      after: "# Projects\n",
    });
    const { deps, calls } = fakeDeps("wiki/Projects/_index.md");
    await undoAction(a, deps);
    expect(calls.writeIndex).toEqual([["Projects", ""]]);
    expect(calls.appended[0]?.status).toBe("reverted");
  });
});

// ─── the secure-intake repair rows (decision 2026-07-22) ─────────────────────
// Rust writes them content-free (empty title, ULID noteId) and already-applied;
// the frontend renders them in history but never offers journal-side undo.

describe("repair rows — content-free, applied, never undoable", () => {
  const repairRow = (): BrainAction => {
    const a = row({
      id: "01JREPAIR",
      action: "repair",
      status: "applied",
      noteId: "01JLEGACYULID",
      noteUlid: "01JLEGACYULID",
      noteTitle: "",
      before: "wiki/_inbox",
      after: "wiki/_secure",
    });
    delete (a as Partial<BrainAction>).area; // Rust repair rows carry no area
    return a;
  };

  test("folds into history like any applied row", () => {
    const v = deriveJournal([repairRow()]);
    expect(v.pending).toEqual([]);
    expect(v.history.map((a) => a.id)).toEqual(["01JREPAIR"]);
  });

  test("describes itself without any note content", () => {
    const text = describeAction(repairRow(), false);
    expect(text).toContain("Secure notes");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("“”");
  });

  test("offers no Undo; undoAction refuses without touching the corpus", async () => {
    const a = repairRow();
    expect(canUndo(a)).toBe(false);
    expect(canUndo(row({}))).toBe(true);
    const { deps, calls } = fakeDeps("wiki/_secure/x.md");
    await expect(undoAction(a, deps)).rejects.toThrow(/remove protection/);
    expect(calls.filerMove).toEqual([]);
    expect(calls.appended).toEqual([]);
  });

  test("approve refuses a repair row (it is applied at write time)", async () => {
    const { deps, calls } = fakeDeps("wiki/_secure/x.md");
    await expect(approveProposal(repairRow(), deps)).rejects.toThrow(/nothing to approve/);
    expect(calls.appended).toEqual([]);
  });
});
