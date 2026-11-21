// A note's permissions as four characters, the verdict the TS/Rust
// differential harness compares (scripts/permission-differential.ts, and
// src-tauri/src/parity_permission_tests.rs `permission_verdict`): body edit
// (a/p/r/l), on-device (t/u/f), locked (1/0), secure (1/0). The lines go
// through the app's own note parse first, as a file on disk does, so a typed
// fact (`id:`, `pinned:` …) is read the way the app reads it; each character
// comes from the reader the app itself calls. Pure.

import { bodyEdit } from "./aiEditPolicy";
import { emptyFrontmatter, isLockedFrontmatter, isSecureFrontmatter, parseNoteDocument } from "./frontmatter";
import { localAiAllowedOverride } from "./frontmatterKeys";

const BODY = { allowed: "a", "person-written": "p", revoked: "r", locked: "l" } as const;

export function permissionVerdict(fields: readonly string[]): string {
  const fm = parseNoteDocument(`---\n${fields.join("\n")}\n---\n`).frontmatter ?? emptyFrontmatter();
  const local = localAiAllowedOverride(fm.foreign);
  return (
    BODY[bodyEdit(fm.foreign)] +
    (local === null ? "u" : local ? "t" : "f") +
    (isLockedFrontmatter(fm) ? "1" : "0") +
    (isSecureFrontmatter(fm) ? "1" : "0")
  );
}
