// The native adapter's contract for a note read (sixth review of pull request
// 267): content, revision and effective protection come back together, from
// one read. And for a create (seventh review): protection and the AI lock go
// to Rust in the one create, so a locked note's recovery copy is locked. Conflict recovery copies a note from that read, so a read that
// lost `secure` made an unprotected copy of a secure note. Rust's side of the
// contract is corpus_write_lane_tests.rs (`a_read_carries_the_effective_protection_the_ipc_sends`).
import { afterEach, expect, test } from "bun:test";

import { FsNotesService } from "./fsNotes";

const host = window as unknown as { __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  delete host.__TAURI_INTERNALS__;
});

/** corpus_read answers with `doc` (Rust's NoteDoc on the wire). */
function nativeRead(doc: Record<string, unknown>) {
  host.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      if (cmd !== "corpus_read") throw new Error(`unexpected ${cmd}`);
      return doc;
    },
    transformCallback: () => 0,
  };
}

const wire = {
  id: "n1",
  folderId: "Inbox",
  diskFolderId: "Inbox",
  body: "# Ledger\n\nprivate",
  revision: "fnv1a64:0000000000000001",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  origin: null,
};

test("a native read carries the note's protection with its body and revision", async () => {
  nativeRead({ ...wire, secure: true, locked: true });
  const note = await new FsNotesService().getNote("n1");
  expect(note).toMatchObject({ body: wire.body, revision: wire.revision, secure: true, locked: true });
  nativeRead({ ...wire, secure: false, locked: false });
  expect(await new FsNotesService().getNote("n1")).toMatchObject({ secure: false, locked: false });
});

test("a read without its protection counts as protected (an older or broken shape fails closed)", async () => {
  nativeRead(wire);
  expect(await new FsNotesService().getNote("n1")).toMatchObject({ secure: true, locked: true });
});

test("a native create sends protection and the AI lock in the one corpus_create", async () => {
  const sent: Record<string, unknown>[] = [];
  host.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "corpus_create") {
        sent.push(args);
        return { ...wire, id: "n2", secure: args.secure, locked: args.locked };
      }
      if (cmd === "corpus_read") return { ...wire, id: "n2", secure: true, locked: true };
      throw new Error(`unexpected ${cmd}`);
    },
    transformCallback: () => 0,
  };
  await new FsNotesService().createNote("Inbox", wire.body, { secure: true, locked: true });
  await new FsNotesService().createNote("Inbox", wire.body, { locked: true });
  expect(sent.map(({ secure, locked }) => ({ secure, locked }))).toEqual([
    { secure: true, locked: true },
    { secure: false, locked: true },
  ]);
});
