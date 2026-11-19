// The real-lane harness (sixth review of pull request 267): the actual
// TypeScript save queue and native adapter (services/fsNotes.ts, through
// @tauri-apps/api's invoke seam) against the production Rust store on a
// temporary vault. No app, no window: Rust runs as the ignored test
// `write_lane_harness` (src-tauri/src/corpus_write_lane_tests.rs), answering
// the same commands the Tauri shell would, one JSON line each.
//
// Run: `bun run test:write-lane` (also the last step of `bun run verify rust`).
// It can hold an IPC call before Rust sees it (a stall in transit), make Rust
// itself sleep before the store call (`delayMs`, answered one request at a
// time like the app's registry mutex), and lose an answer after Rust did the
// work (a create whose read-back failed). The schedules replayed here are the
// ones the save-state explorer (saveExplorer.test.ts) and the seventh review
// found, translated by hand onto the real store.
// What it can't show: two windows writing the same note, slow storage below
// Rust's own calls, and native paint and window events.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type { Note } from "../types";
import { outcome, settle as settleFor, until as untilFor } from "./saveTest.fixtures";

type Model = typeof import("./model");
type Status = typeof import("./saveStatus");

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const pending = new Map<number, Waiter>();
const unknownCommands = new Set<string>();
let seq = 0;
let child: ChildProcessByStdio<Writable, Readable, null> | null = null;
let model: Model;
let status: Status;

// IPC calls the test holds before Rust sees them (a stall in transit).
const gates: Record<string, { held: boolean; waiting: (() => void)[] }> = {
  corpus_write: { held: false, waiting: [] },
  corpus_create: { held: false, waiting: [] },
  corpus_read: { held: false, waiting: [] },
};
// How long Rust sleeps before the store call, per command; and requests whose
// answer is lost after Rust did the work (`lose(args)` says which).
const delays: Record<string, number> = {};
const losing: Record<string, (args: Record<string, unknown>) => boolean> = {};
const sent: Record<string, number> = {};
const ANSWERED = new Set([
  "corpus_list",
  "corpus_read",
  "corpus_write",
  "corpus_create",
  "corpus_move",
  "corpus_delete",
  "corpus_purge",
  "corpus_set_secure",
]);

function rust(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  seq += 1;
  const id = seq;
  const answer = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  const delayMs = delays[cmd];
  child!.stdin.write(`${JSON.stringify({ seq: id, cmd, args, ...(delayMs ? { delayMs } : {}) })}\n`);
  return answer;
}

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  // the app's modules listen for window events when they load; no window here
  if (cmd.startsWith("plugin:event|")) return 0;
  if (!ANSWERED.has(cmd)) {
    unknownCommands.add(cmd);
    throw new Error(`${cmd}: not part of the write lane`);
  }
  const gate = gates[cmd];
  if (gate?.held) await new Promise<void>((resolve) => gate.waiting.push(resolve));
  sent[cmd] = (sent[cmd] ?? 0) + 1;
  const value = await rust(cmd, args);
  const lose = losing[cmd];
  if (lose?.(args)) {
    delete losing[cmd];
    throw new Error(`${cmd}: the answer was lost`);
  }
  return value;
}

function readAnswers(stream: NodeJS.ReadableStream) {
  let carry = "";
  stream.on("data", (chunk: Buffer) => {
    carry += chunk.toString("utf8");
    let at: number;
    while ((at = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, at);
      carry = carry.slice(at + 1);
      if (!line.startsWith("@lane ")) continue;
      const answer = JSON.parse(line.slice(6)) as {
        seq: number;
        ok: boolean;
        value?: unknown;
        error?: string;
      };
      const waiter = pending.get(answer.seq);
      pending.delete(answer.seq);
      if (answer.ok) waiter?.resolve(answer.value);
      else waiter?.reject(new Error(answer.error));
    }
  });
}

beforeAll(async () => {
  child = spawn(
    "cargo",
    [
      "test",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "write_lane_harness",
      "--",
      "--ignored",
      "--nocapture",
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  readAnswers(child.stdout);
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  };
  model = await import("./model");
  status = await import("./saveStatus");
  await rust("notes"); // compiled and listening
}, 600_000);

afterAll(async () => {
  const done = child ? new Promise((resolve) => child!.once("exit", resolve)) : null;
  child?.stdin.end();
  await done;
});

const settle = () => settleFor(10, 2);
const until = (ready: () => boolean) => untilFor(ready, 500, 2);

type Gated = "corpus_write" | "corpus_create" | "corpus_read";
function hold(cmd: Gated) {
  gates[cmd]!.held = true;
}
async function release(cmd: Gated) {
  gates[cmd]!.held = false;
  while (gates[cmd]!.waiting.length) gates[cmd]!.waiting.shift()?.();
  await settle();
}
const waiting = (cmd: Gated) => gates[cmd]!.waiting.length;

interface Listed {
  id: string;
  body: string;
  secure: boolean;
  locked: boolean;
  folderId: string;
}
const everyNote = async () => (await rust("notes")) as Listed[];
const disk = async (id: string) => (await rust("corpus_read", { id })) as Note & { secure: boolean };

/** A new note in the temporary vault, open in the editor as the app opens one. */
async function open(body: string, secure = false, locked = false): Promise<string> {
  const meta = (await rust("corpus_create", { folderId: "Inbox", body, secure, locked })) as { id: string };
  const { notesService } = await import("../services/notes");
  const note = (await notesService.getNote(meta.id))!;
  model.ensureDocument(note.id, note.body, note.revision, note);
  return note.id;
}

test("the original overlap: a second save waits, then lands on the first one's revision", async () => {
  const id = await open("# Overlap\n\nfirst");
  hold("corpus_write");
  model.setDocumentText(id, "# Overlap\n\nA");
  const first = outcome(model.flushNote(id));
  await until(() => waiting("corpus_write") === 1);
  model.setDocumentText(id, "# Overlap\n\nA and the last keystrokes");
  const second = outcome(model.flushNote(id));
  await settle();
  expect(waiting("corpus_write")).toBe(1); // never two writes on one base
  await release("corpus_write");
  await Promise.all([first, second]);
  expect((await disk(id)).body).toBe("# Overlap\n\nA and the last keystrokes");
  expect(status.isDirty(id)).toBe(false);
});

test("three overlapping saves: one more write after the first, with the newest words", async () => {
  const id = await open("# Three\n\nfirst");
  hold("corpus_write");
  for (const words of ["A", "B", "C"]) {
    model.setDocumentText(id, `# Three\n\n${words}`);
    void model.flushNote(id).catch(() => {});
    await settle();
  }
  await release("corpus_write");
  await model.flushNote(id);
  expect((await disk(id)).body).toBe("# Three\n\nC");
});

test("a retitle and a move while a write is queued: the note keeps its identity and the newest words", async () => {
  const id = await open("# Before\n\nfirst");
  hold("corpus_write");
  model.setDocumentText(id, "# After\n\nretitled");
  void model.flushNote(id).catch(() => {});
  await until(() => waiting("corpus_write") === 1);
  model.setDocumentText(id, "# After\n\nretitled, then moved");
  void model.flushNote(id).catch(() => {});
  await rust("corpus_move", { id, targetFolder: "Archive" }); // the Librarian files it meanwhile
  await release("corpus_write");
  await model.flushNote(id);
  const after = await disk(id);
  expect(after.body).toBe("# After\n\nretitled, then moved");
  expect(after.folderId).toBe("Archive");
  expect(status.isDirty(id)).toBe(false);
});

test("F1: a conflict, and words typed while its copy is made, all survive quit", async () => {
  const id = await open("# Conflict\n\nbase");
  model.setDocumentText(id, "# Conflict\n\nmine A");
  await rust("external", { id, body: "# Conflict\n\noutside" });
  hold("corpus_create");
  const quit = outcome(model.flushSyncs());
  await until(() => waiting("corpus_create") === 1);
  model.setDocumentText(id, "# Conflict\n\nmine A plus B");
  await release("corpus_create");
  await quit;
  const copies = (await everyNote()).filter((note) => note.body.startsWith("# Conflict (unsaved edits"));
  expect(copies.map((note) => note.body.split("\n")[2])).toEqual(["mine A plus B"]); // one copy, newest words
  expect((await disk(id)).body).toBe("# Conflict\n\noutside");
});

test("a write whose answer was lost isn't taken for another app's edit: the undo it was followed by lands", async () => {
  const id = await open("# Lost\n\nbase");
  model.setDocumentText(id, "# Lost\n\nchanged");
  losing.corpus_write = () => true; // Rust wrote "changed"; the answer is lost
  await model.flushNote(id).catch(() => {});
  model.setDocumentText(id, "# Lost\n\nbase"); // the person undoes
  expect(await outcome(model.flushSyncs(20_000))).toBe("done");
  expect((await disk(id)).body).toBe("# Lost\n\nbase");
  expect((await everyNote()).filter((note) => note.body.startsWith("# Lost"))).toHaveLength(1); // no conflict copy
});

test("1: a write past its bound, then undo: quit refuses until that write lands, and the restored words land last", async () => {
  model.setWriteLimitForTests(60);
  try {
    const id = await open("# Stall\n\nbase");
    hold("corpus_write");
    model.setDocumentText(id, "# Stall\n\nobsolete");
    expect(await outcome(model.flushSyncs(200))).toContain("“Stall” is still waiting on the disk");
    model.setDocumentText(id, "# Stall\n\nbase"); // restored
    expect(await outcome(model.flushSyncs(200))).toContain("“Stall” is still waiting on the disk");
    expect(waiting("corpus_write")).toBe(1); // nothing went out beside it
    await release("corpus_write"); // Rust accepts it: the body still equals its base
    expect(await outcome(model.flushSyncs())).toBe("done");
    expect((await disk(id)).body).toBe("# Stall\n\nbase");
  } finally {
    model.setWriteLimitForTests(null);
  }
});

test("real delay inside Rust: an honest write past the bound is waited for, and one write at a time goes out", async () => {
  model.setWriteLimitForTests(40);
  delays.corpus_write = 150; // Rust sleeps before the store call, holding everything behind it
  try {
    const id = await open("# Slow\n\nfirst");
    const before = sent.corpus_write ?? 0;
    model.setDocumentText(id, "# Slow\n\nA");
    const quit = outcome(model.flushSyncs(80));
    await settle();
    model.setDocumentText(id, "# Slow\n\nA and B"); // typed while Rust sleeps
    expect(await quit).toContain("“Slow” is still waiting on the disk");
    expect((sent.corpus_write ?? 0) - before).toBe(1);
    expect(await outcome(model.flushSyncs(2000))).toBe("done");
    expect((await disk(id)).body).toBe("# Slow\n\nA and B");
    expect((sent.corpus_write ?? 0) - before).toBe(2);
  } finally {
    delete delays.corpus_write;
    model.setWriteLimitForTests(null);
  }
});

test("F3: a create answers with what it wrote: a writer right after it is never certified as Rotli's", async () => {
  const { notesService } = await import("../services/notes");
  hold("corpus_read"); // an adapter that reads back after creating waits here
  let made: Note | null = null;
  const making = notesService.createNote("Inbox", "# Mine\n\nfirst").then((note) => (made = note));
  await settle();
  const created = (await everyNote()).find((note) => note.body.startsWith("# Mine"))!;
  await rust("external", { id: created.id, body: "# Mine\n\nother writer" });
  await release("corpus_read");
  await making;
  expect(made!.body).toBe("# Mine\n\nfirst");
  // a later write on what Rotli wrote is refused, not laid over the other writer
  expect(
    await outcome(notesService.updateNote(made!.id, "# Mine\n\nnewer", made!.revision, made!.body)),
  ).toContain("revision conflict");
  expect((await disk(made!.id)).body).toBe("# Mine\n\nother writer");
});

test("F5: a secure conflict copy whose answer was lost is found again where Rust routed it, not made twice", async () => {
  const id = await open("# Vault\n\nbase", true, true);
  model.setDocumentText(id, "# Vault\n\nmine");
  await rust("external", { id, body: "# Vault\n\ntheirs" });
  losing.corpus_create = () => true; // Rust made the copy in the secure home; the answer is lost
  expect(await outcome(model.flushSyncs())).toBe("done");
  const copies = (await everyNote()).filter((note) => note.body.startsWith("# Vault (unsaved edits"));
  expect(copies.map((note) => [note.secure, note.locked, note.folderId])).toEqual([
    [true, true, "Secure notes"],
  ]);
});

test("3: a read that never answers is left behind at the bound: the conflict is copied once the disk answers", async () => {
  model.setWriteLimitForTests(60);
  try {
    const id = await open("# Unread\n\nbase");
    model.setDocumentText(id, "# Unread\n\nmine");
    await rust("external", { id, body: "# Unread\n\ntheirs" });
    hold("corpus_read");
    expect(await outcome(model.flushSyncs(400))).toContain("“Unread”");
    await release("corpus_read");
    expect(await outcome(model.flushSyncs())).toBe("done");
    const copies = (await everyNote()).filter((note) => note.body.startsWith("# Unread (unsaved edits"));
    expect(copies.map((note) => note.body.split("\n")[2])).toEqual(["mine"]);
    expect((await disk(id)).body).toBe("# Unread\n\ntheirs");
  } finally {
    model.setWriteLimitForTests(null);
  }
});

test("a conflict copy whose create answered with an error is found, not made twice", async () => {
  const id = await open("# Twice\n\nbase");
  model.setDocumentText(id, "# Twice\n\nmine");
  await rust("external", { id, body: "# Twice\n\ntheirs" });
  losing.corpus_create = () => true; // Rust made the copy; the answer is lost
  expect(await outcome(model.flushSyncs())).toBe("done");
  const copies = (await everyNote()).filter((note) => note.body.startsWith("# Twice (unsaved edits"));
  expect(copies).toHaveLength(1);
});

test("5: a locked note's conflict copy is locked, from the native create", async () => {
  const id = await open("# Locked\n\nbase", false, true);
  model.setDocumentText(id, "# Locked\n\nmine");
  await rust("external", { id, body: "# Locked\n\ntheirs" });
  expect(await outcome(model.flushSyncs())).toBe("done");
  const copy = (await everyNote()).find((note) => note.body.startsWith("# Locked (unsaved edits"));
  expect(copy).toMatchObject({ secure: false, locked: true });
});

test("a note purged with unsaved words: they stay in its editor, and quit names it until they are discarded", async () => {
  const id = await open("# Purged\n\nfirst", true);
  model.setDocumentText(id, "# Purged\n\nwords nobody saved");
  await rust("corpus_delete", { id });
  await rust("corpus_purge", { id });
  await model.flushNote(id).catch(() => {});
  expect(await outcome(model.flushSyncs())).toContain("“Purged” was deleted");
  expect(model.getDocumentText(id)).toBe("# Purged\n\nwords nobody saved");
  expect((await everyNote()).filter((note) => note.body.includes("words nobody saved"))).toEqual([]);
  model.discardGoneNote(id);
  expect(await outcome(model.flushSyncs())).toBe("done");
});

test("F7: a secure note's conflict copy is secure, from the native read", async () => {
  const id = await open("# Private\n\nbase", true);
  model.setDocumentText(id, "# Private\n\nmine");
  await rust("external", { id, body: "# Private\n\ntheirs" });
  await outcome(model.flushSyncs());
  const copy = (await everyNote()).find((note) => note.body.startsWith("# Private (unsaved edits"));
  expect(copy?.secure).toBe(true);
});

test("the harness answered every command the queue sent", () => {
  expect([...unknownCommands]).toEqual([]);
});
