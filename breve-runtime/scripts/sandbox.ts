/**
 * Per-principal knowledge/storage roots.
 *
 * This module formerly built a macOS Seatbelt profile for cloud-provider
 * subprocesses. Breve is now on-device only, so no model process is wrapped or
 * spawned here. Signal still needs the same narrow root set when it assembles
 * local-model context for an administrator or member partition.
 */
import { join, resolve } from "node:path";

import { storagePath } from "./config";

const BREVE_ROOT = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
export const BREVE_CODE_ROOT =
  process.env.ROTLI_BREVE_CODE ?? resolve(BREVE_ROOT, "..", "breve-runtime");

export type SandboxRoots = { readRoots: string[]; writeRoots: string[] };

/**
 * Build the local-context roots for one partition. An administrator may use
 * shared storage and the managed runtime; a member receives only their own
 * knowledge and storage roots.
 */
export function rootsForPartition(opts: {
  knowledgeRoot: string;
  storageRoot?: string;
  admin?: boolean;
}): SandboxRoots {
  if (opts.admin) {
    const storage = storagePath();
    return {
      readRoots: [opts.knowledgeRoot, storage, BREVE_ROOT, BREVE_CODE_ROOT],
      writeRoots: [opts.knowledgeRoot, storage, BREVE_ROOT],
    };
  }
  const storage = opts.storageRoot ?? opts.knowledgeRoot;
  return {
    readRoots: [opts.knowledgeRoot, storage],
    writeRoots: [opts.knowledgeRoot, storage],
  };
}
