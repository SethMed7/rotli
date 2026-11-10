// The real-lane harness (sixth review of pull request 267): the actual
// TypeScript save queue and native adapter (services/fsNotes.ts, through
// @tauri-apps/api's invoke seam) against the production Rust store on a
// temporary vault. No app, no window: Rust runs as the ignored test
// `write_lane_harness` (src-tauri/src/corpus_write_lane_tests.rs), answering
// the same commands the Tauri shell would, one JSON line each.
//
// Run: `bun run test:write-lane` (also the last step of `bun run verify rust`).
// What it can't show: two windows writing the same note, slow storage inside
// Rust (a held IPC stands in for a stall), and native paint and window events.

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
};
const ANSWERED = new Set([
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
  child!.stdin.write(`${JSON.stringify({ seq: id, cmd, args })}\n`);
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
  return rust(cmd, args);
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

function hold(cmd: "corpus_write" | "corpus_create") {
  gates[cmd]!.held = true;
}
async function releaseFirst(cmd: "corpus_write" | "corpus_create") {
  gates[cmd]!.waiting.shift()?.();
  await settle();
}
async function releaseLast(cmd: "corpus_write" | "corpus_create") {
  gates[cmd]!.waiting.pop()?.();
  await settle();
}
async function release(cmd: "corpus_write" | "corpus_create") {
  gates[cmd]!.held = false;
  while (gates[cmd]!.waiting.length) gates[cmd]!.waiting.shift()?.();
  await settle();
}
const waiting = (cmd: "corpus_write" | "corpus_create") => gates[cmd]!.waiting.length;

interface Listed {
  id: string;
  body: string;
  secure: boolean;
}
const everyNote = async () => (await rust("notes")) as Listed[];
const disk = async (id: string) => (await rust("corpus_read", { id })) as Note & { secure: boolean };

/** A new note in the temporary vault, open in the editor as the app opens one. */
async function open(body: string, secure = false): Promise<string> {
  const meta = (await rust("corpus_create", { folderId: "Inbox", body, secure })) as { id: string };
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
  const bodies = (await everyNote()).map((note) => note.body);
  expect(bodies.some((body) => body.includes("mine A plus B"))).toBe(true);
  expect((await disk(id)).body).toBe("# Conflict\n\noutside");
});

test("F2: a stalled write names the note within quit's bound; arriving late, after newer words, Rust refuses it", async () => {
  model.setWriteLimitForTests(60);
  try {
    const id = await open("# Stall\n\nfirst");
    hold("corpus_write");
    model.setDocumentText(id, "# Stall\n\nchanged");
    expect(await outcome(model.flushSyncs())).toContain("“Stall”");
    model.setDocumentText(id, "# Stall\n\nchanged and more");
    const retry = outcome(model.flushSyncs());
    await until(() => waiting("corpus_write") === 2);
    await releaseLast("corpus_write"); // the retry lands
    await release("corpus_write"); // the stalled write arrives late
    await retry;
    await outcome(model.flushSyncs());
    expect((await disk(id)).body).toBe("# Stall\n\nchanged and more");
    expect(status.isDirty(id)).toBe(false);
  } finally {
    model.setWriteLimitForTests(null);
  }
});

test("F2: the stalled write lands between the retry's read and its write: Rotli's own words never merge back in", async () => {
  model.setWriteLimitForTests(60);
  try {
    const id = await open("# Late\n\nfirst");
    hold("corpus_write");
    model.setDocumentText(id, "# Late\n\nchanged");
    await outcome(model.flushSyncs());
    model.setDocumentText(id, "# Late\n\nfirst"); // typed back
    const retry = outcome(model.flushSyncs());
    await until(() => waiting("corpus_write") === 2);
    await releaseFirst("corpus_write"); // the stalled write lands first
    await release("corpus_write");
    await retry;
    await outcome(model.flushSyncs());
    expect((await disk(id)).body).toBe("# Late\n\nfirst");
    expect((await everyNote()).filter((note) => note.body.includes("Late"))).toHaveLength(1);
  } finally {
    model.setWriteLimitForTests(null);
  }
});

test("F3: a note purged with unsaved words: quit names it until the words are kept, protected", async () => {
  const id = await open("# Purged\n\nfirst", true);
  model.setDocumentText(id, "# Purged\n\nwords nobody saved");
  await rust("corpus_delete", { id });
  await rust("corpus_purge", { id });
  await model.flushNote(id).catch(() => {});
  expect(await outcome(model.flushSyncs())).toContain("“Purged” was deleted");
  await model.keepGoneNote(id);
  const kept = (await everyNote()).find((note) => note.body.includes("words nobody saved"));
  expect(kept?.secure).toBe(true);
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
