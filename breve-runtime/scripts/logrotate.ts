#!/usr/bin/env bun
/**
 * BREVE log rotation — logs grow forever without it. Standalone, called by the doctor loop.
 *   Oversized *.log in logs/ → roll to <name>.1 (overwrite), truncate the original to "" so
 *   a process holding the file open keeps writing. Old transcripts/queue files → pruned by mtime.
 * Never throws: every op is try/catch'd and the action log is returned (and printed via CLI).
 *
 *   bun scripts/logrotate.ts   (no-op safe when nothing is oversized or stale)
 */
import { statSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { BREVE } from "./paths";

export async function rotate(opts?: { maxLogMB?: number; keepDays?: number }): Promise<string[]> {
  const maxLogMB = opts?.maxLogMB ?? 10;
  const keepDays = opts?.keepDays ?? 14;
  const maxBytes = maxLogMB * 1024 * 1024;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const did: string[] = [];

  // Roll oversized logs in place — keep the inode alive so open writers don't break.
  const logsDir = join(BREVE, "logs");
  let logs: string[] = [];
  try { logs = readdirSync(logsDir).filter((f) => f.endsWith(".log")); } catch {}
  for (const f of logs) {
    const p = join(logsDir, f);
    try {
      if (statSync(p).size <= maxBytes) continue;
      renameSync(p, `${p}.1`); // overwrite any existing .1
      writeFileSync(p, ""); // fresh empty file at the same path
      did.push(`rolled ${f} → ${f}.1 (over ${maxLogMB}MB)`);
    } catch (e) { did.push(`skip ${f}: ${(e as Error).message}`); }
  }

  // Prune stale transcripts + queued items by mtime.
  for (const sub of ["transcripts", "queue"]) {
    const dir = join(BREVE, "signal", sub);
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const p = join(dir, f);
      try {
        const s = statSync(p);
        if (!s.isFile() || s.mtimeMs >= cutoff) continue;
        unlinkSync(p);
        did.push(`pruned ${sub}/${f} (older than ${keepDays}d)`);
      } catch (e) { did.push(`skip ${sub}/${f}: ${(e as Error).message}`); }
    }
  }

  return did;
}

if (import.meta.main) {
  const did = await rotate();
  console.log(did.length ? did.join("\n") : "logrotate: nothing to do");
}
