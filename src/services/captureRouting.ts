// One routing policy for the two global capture entry points. An empty target
// preserves the active-vault behavior; an explicit target is exact and never
// falls through to another vault if it becomes unavailable or read-only.

import {
  CORPUS_INSTANCE_ID,
  type MemexConfig,
  type MemexInstance,
  activeInstance,
  isWritable,
} from "../memex/config";
import { loadConfig, writeNote } from "../memex/service";

export function captureDestination(config: MemexConfig, targetId: string | null): MemexInstance | null {
  if (!targetId) {
    const active = activeInstance(config);
    return isWritable(active) ? active : null;
  }
  const requested = config.instances.find((candidate) => candidate.id === targetId);
  if (!requested)
    throw new Error("The chosen capture vault is no longer available. Choose another in Settings.");
  if (!isWritable(requested)) {
    throw new Error("The chosen capture vault no longer has write access. Update it in Settings → Location.");
  }
  return requested;
}

export function captureWireId(instance: MemexInstance, noteId: string): string {
  return `${instance.id === CORPUS_INSTANCE_ID ? "" : `${instance.id}:`}${noteId}`;
}

/** Write a secure capture into the selected memex intake. A null result means
 * the default route has no writable memex and the caller may use its existing
 * local fallback. Explicit unavailable targets throw instead of misfiling. */
export async function createVaultCapture(targetId: string | null, body: string): Promise<string | null> {
  const instance = captureDestination(await loadConfig(), targetId);
  if (!instance) return null;
  // ⌥C is the ONE writer of the capture shelf: `Inbox` is what Rust projects
  // to the Captures board (the owner, 2026-09-17: nothing else adds to it)
  const { id } = await writeNote({ instance, body, secure: true, shelf: ["Inbox"] });
  return captureWireId(instance, id);
}
