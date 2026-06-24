// The rotli-side view of "which memex am I pointed at." The Rust registry
// (memex-instances.json, in the app config dir) is the source of truth; this maps
// its wire shape into the app's model + a couple of pure reducers. Mirrors how
// Breve's config.ts adapts the brain wiring — but rotli supports MULTIPLE
// instances (the user can keep separate, non-blending brains).

import type { MemexInstanceEntry, MemexPerms, MemexRegistry } from "../lib/tauri";

export type Perms = MemexPerms;

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
}

export interface MemexConfig {
  activeId: string | null;
  instances: MemexInstance[];
}

export const EMPTY_CONFIG: MemexConfig = { activeId: null, instances: [] };

function fromEntry(e: MemexInstanceEntry): MemexInstance {
  return {
    id: e.id,
    label: e.label,
    root: e.absPath,
    role: e.role,
    memexId: e.memexId,
    mode: e.mode,
    perms: e.perms,
  };
}

export function fromRegistry(reg: MemexRegistry): MemexConfig {
  return { activeId: reg.activeId, instances: reg.instances.map(fromEntry) };
}

export const activeInstance = (c: MemexConfig): MemexInstance | null =>
  c.instances.find((i) => i.id === c.activeId) ?? null;

export const instanceById = (c: MemexConfig, id: string): MemexInstance | null =>
  c.instances.find((i) => i.id === id) ?? null;

/** Whether this instance can be written to (perms + a connected, in-range brain). */
export const isWritable = (i: MemexInstance | null): boolean => i?.perms === "chats+inbox";
