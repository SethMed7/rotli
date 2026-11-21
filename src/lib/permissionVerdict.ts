// A note's permissions as four characters, the verdict the TS/Rust
// differential harness compares (scripts/permission-differential.ts, and
// src-tauri/src/parity_permission_tests.rs `permission_verdict`): body edit
// (a/p/r/l), on-device (t/u/f), locked (1/0), secure (1/0). Each character
// comes from the reader the app itself calls. Pure.

import { bodyEdit } from "./aiEditPolicy";
import { emptyFrontmatter, isLockedFrontmatter, isSecureFrontmatter } from "./frontmatter";
import { localAiAllowedOverride } from "./frontmatterKeys";

const BODY = { allowed: "a", "person-written": "p", revoked: "r", locked: "l" } as const;

export function permissionVerdict(fields: readonly string[]): string {
  const fm = { ...emptyFrontmatter(), foreign: [...fields] };
  const local = localAiAllowedOverride(fields);
  return (
    BODY[bodyEdit(fields)] +
    (local === null ? "u" : local ? "t" : "f") +
    (isLockedFrontmatter(fm) ? "1" : "0") +
    (isSecureFrontmatter(fm) ? "1" : "0")
  );
}
