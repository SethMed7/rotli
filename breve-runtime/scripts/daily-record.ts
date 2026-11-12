/**
 * How the daily digest lands in history/ (system audit 2026-09-02 §6 #2): the
 * new text goes to a sibling temp file and is renamed over the day's record,
 * so a crash or a full disk mid-write leaves yesterday's run, never an empty
 * or half-written day. An empty distillation never replaces a day already
 * written; the stub is only for a day that has nothing yet.
 */
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";

export function writeFileAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    // on disk before the rename: after a power loss the rename can survive
    // while unsynced data doesn't, which would leave an empty day
    const file = openSync(tmp, "w");
    try {
      writeSync(file, text);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Write the day's record. Returns what happened, for the run's log line. */
export function writeDailyRecord(
  outPath: string,
  markdown: string,
  stub: string,
): "written" | "kept" | "stub" {
  const body = markdown.trim();
  if (body) {
    writeFileAtomic(outPath, `${body}\n`);
    return "written";
  }
  if (existsSync(outPath)) return "kept";
  writeFileAtomic(outPath, stub);
  return "stub";
}
