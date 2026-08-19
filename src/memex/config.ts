// The rotli-side view of "which brain am I writing to." The unified `corpus.json`
// (read via corpus_list_config) is the source of truth; this maps its view shape
// into the app's MemexInstance model + a couple of pure reducers. The corpus is
// THE one folder = your notes = your brain: when it's a memex it IS the active
// write target; otherwise the active CONNECTED brain is. Other connected brains
// surface as additional (read-only) instances.

import type { CorpusConfigView, MemexPerms } from "../lib/tauri";

export type Perms = MemexPerms;

/** The synthetic instance id for "the corpus itself is a brain". */
export const CORPUS_INSTANCE_ID = "corpus";

export interface MemexInstance {
  id: string;
  label: string;
  /** Absolute path to the memex root. */
  root: string;
  role: string;
  memexId: string | null;
  /** Access mode snapshot ("local"|"open"|"secure"); re-read on open. */
  mode: string | null;
  perms: Perms;
  /** The vault's Librarian switch (per-root display fact; raw = false). */
  brainEnabled: boolean;
}

export interface MemexConfig {
  activeId: string | null;
  instances: MemexInstance[];
  developmentReadOnly: boolean;
}

function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "brain";
}

/** Map the unified corpus view into the app's instance model. A memex corpus
 * becomes the (active) `CORPUS_INSTANCE_ID` instance; connected brains follow.
 * When the corpus is NOT a memex, the active CONNECTED brain stays the write
 * target — so an existing "plain corpus + connected brain" setup is unchanged. */
export function fromCorpusConfig(v: CorpusConfigView): MemexConfig {
  const instances: MemexInstance[] = [];
  if (v.corpus.isMemex) {
    instances.push({
      id: CORPUS_INSTANCE_ID,
      label: baseName(v.corpus.absPath),
      root: v.corpus.absPath,
      role: "corpus",
      memexId: v.corpus.memexId,
      mode: null,
      perms: v.corpus.perms ?? "read-only",
      brainEnabled: v.corpus.brainEnabled ?? true,
    });
  }
  for (const b of v.brains) {
    instances.push({
      id: b.id,
      label: b.label,
      root: b.absPath,
      role: "brain",
      memexId: b.memexId,
      mode: b.mode,
      perms: b.perms,
      brainEnabled: b.brainEnabled ?? true,
    });
  }
  const activeId = v.corpus.isMemex ? CORPUS_INSTANCE_ID : v.activeBrainId;
  return { activeId, instances, developmentReadOnly: v.developmentReadOnly };
}

export const activeInstance = (c: MemexConfig): MemexInstance | null =>
  c.instances.find((i) => i.id === c.activeId) ?? null;

/** Whether this instance can be written to (perms + a connected, in-range brain). */
export const isWritable = (i: MemexInstance | null): boolean => i?.perms === "chats+inbox";
