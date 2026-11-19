// A test fake of the editor's write lane that follows Rust's contract
// (CorpusStore::write_if_revision_with_body_base), not a stricter one. The
// sixth review of pull request 267 found the old fake refused every stale
// revision, while Rust accepts one whose editor body is unchanged (a pin, a
// move, the Librarian's metadata). src/editor/writeLane.test.ts runs
// scripts/fixtures/write-lane-contract.json against this fake, and
// src-tauri/src/corpus_write_lane_tests.rs runs the same file against the store.

import { contentRevision } from "../lib/contentRevision";
import type { Note } from "../types";

/** Rust's fsutil::revision (FNV-1a 64 over the complete file's bytes), as
 * Rotli Web computes it; vaultDir.test.ts holds the two equal. */
const revisionOf = contentRevision;

interface FakeFile {
  folder: string;
  /** Frontmatter lines (Rotli's metadata), kept across body writes. */
  meta: string[];
  body: string;
}

const fileText = (file: FakeFile) => `---\n${file.meta.join("\n")}\n---\n\n${file.body}`;

export interface FakeLane {
  files: Map<string, FakeFile>;
  read(id: string): Note | null;
  /** The editor's save: Rust's rules, checked when the write lands. */
  write(id: string, body: string, expectedRevision: string, expectedBody?: string): Note;
  /** Rust's create: a secure note goes to the secure home (a legacy vault's
   * "Secure notes"), and a recovery event makes it idempotent: the note made
   * for that event before comes back, if its protection is the same. */
  create(folder: string, body: string, policy?: { secure?: boolean; locked?: boolean; event?: string }): Note;
  /** Another app (or the CLI) writes the body without a revision. */
  external(id: string, body: string): void;
  /** Rotli's own metadata change: the revision moves, the body doesn't. */
  pin(id: string): void;
  lock(id: string): void;
  move(id: string, folder: string): void;
  purge(id: string): void;
  /** Purged files, by id, so another app can put one back. */
  purged: Map<string, FakeFile>;
  /** Another app puts a purged file back. */
  restore(id: string): void;
}

/** `prefix` names the notes it creates (`<prefix>-1`, …), so lanes never share an id. */
export function fakeLane(prefix = "note"): FakeLane {
  const files = new Map<string, FakeFile>();
  const purged = new Map<string, FakeFile>();
  let next = 0;
  const note = (id: string): Note => {
    const file = files.get(id)!;
    return {
      id,
      title: file.body.split("\n")[0]?.replace(/^#\s*/, "") ?? "",
      snippet: "",
      folderId: file.folder,
      createdAt: 0,
      updatedAt: 0,
      pinned: file.meta.includes("pinned: true"),
      secure: file.meta.includes("secure: true"),
      locked: file.meta.includes("locked: true"),
      body: file.body,
      revision: revisionOf(fileText(file)),
    };
  };
  const found = (id: string) => {
    const file = files.get(id);
    if (!file) throw new Error(`note not found: ${id}`);
    return file;
  };
  return {
    files,
    read: (id) => (files.has(id) ? note(id) : null),
    write(id, body, expectedRevision, expectedBody) {
      const file = found(id);
      const current = revisionOf(fileText(file));
      if (current !== expectedRevision && expectedBody !== file.body)
        throw new Error(
          `revision conflict: expected ${expectedRevision}, found ${current}; the file changed after it was opened`,
        );
      file.body = body;
      return note(id);
    },
    create(folder, body, policy) {
      const marker = policy?.event ? `recovery: ${policy.event}` : null;
      const made = marker ? [...files.entries()].find(([, file]) => file.meta.includes(marker)) : undefined;
      if (made) {
        const same =
          made[1].meta.includes("secure: true") === !!policy?.secure &&
          made[1].meta.includes("locked: true") === !!policy?.locked;
        if (!same) throw new Error("the recovery note made for this event doesn't carry the same protection");
        return note(made[0]);
      }
      next += 1;
      const id = `${prefix}-${next}`;
      const meta = [`id: ${id}`];
      if (policy?.secure) meta.push("secure: true");
      if (policy?.locked) meta.push("locked: true");
      if (marker) meta.push(marker);
      const home = policy?.secure && !folder.startsWith("Secure notes") ? "Secure notes" : folder;
      files.set(id, { folder: home, meta, body });
      return note(id);
    },
    external(id, body) {
      found(id).body = body;
    },
    pin(id) {
      found(id).meta.push("pinned: true");
    },
    lock(id) {
      found(id).meta.push("locked: true");
    },
    move(id, folder) {
      found(id).folder = folder;
      found(id).meta.push(`origin: moved`);
    },
    purge(id) {
      purged.set(id, found(id));
      files.delete(id);
    },
    purged,
    restore(id) {
      const file = purged.get(id);
      if (!file) throw new Error(`nothing to restore: ${id}`);
      purged.delete(id);
      files.set(id, file);
    },
  };
}
