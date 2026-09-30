// A note's protection controls — lock, secure, on-device access, and the AI
// edit grant (split out of tauri.ts, 2026-09-29). Each writes one Rotli-owned
// frontmatter line through its own Rust command; Rust owns every verdict.
// Outside the Mac app they do nothing.

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./tauri";

/** Toggle the per-note AI lock (writes/removes a `locked: true` frontmatter line). */
export async function corpusSetLocked(id: string, locked: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_locked", { id, locked });
}

/** The person's per-note grant for AI body edits (`ai_edit: true|false`). */
export async function corpusSetAiEdit(id: string, allowed: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_ai_edit", { id, allowed });
}

/** Toggle the per-note SECURE flag (secrets → never sent remote, gitignored). */
export async function corpusSetSecure(id: string, secure: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_secure", { id, secure });
}

/** Permit loopback-local AI to read a secure note. Remote providers remain
 * categorically blocked regardless of this value. */
export async function corpusSetLocalAiAccess(id: string, allowed: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("corpus_set_local_ai_access", { id, allowed });
}
