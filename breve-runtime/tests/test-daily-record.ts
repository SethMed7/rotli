import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeDailyRecord, writeFileAtomic } from "../scripts/daily-record";

const TMP = mkdtempSync(join(tmpdir(), "breve-daily-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const STUB = "---\nsummary: (to fill)\n---\n";

function day(name: string, existing?: string): string {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "2026-11-11.md");
  if (existing !== undefined) writeFileSync(path, existing);
  return path;
}

describe("the daily digest's write", () => {
  test("a distilled day lands whole, with one trailing newline", () => {
    const path = day("written", "old\n");
    expect(writeDailyRecord(path, "\n# 2026-11-11\n\nbody  \n", STUB)).toBe("written");
    expect(readFileSync(path, "utf8")).toBe("# 2026-11-11\n\nbody\n");
  });

  test("an empty distillation never replaces a day already written", () => {
    // the old write put the stub over the morning's digest when a rerun's
    // model came back empty
    const path = day("kept", "# 2026-11-11\n\nthe morning's digest\n");
    expect(writeDailyRecord(path, "   ", STUB)).toBe("kept");
    expect(readFileSync(path, "utf8")).toBe("# 2026-11-11\n\nthe morning's digest\n");
  });

  test("a day with nothing yet gets the stub", () => {
    const path = day("stub");
    expect(writeDailyRecord(path, "", STUB)).toBe("stub");
    expect(readFileSync(path, "utf8")).toBe(STUB);
  });

  test("a write that fails leaves the old day and no temp file behind", () => {
    const path = day("failed", "the day as it was\n");
    // a directory where the temp file must go: the write throws before rename
    const blocker = `${path}.${process.pid}.tmp`;
    mkdirSync(blocker);
    expect(() => writeFileAtomic(path, "half a day")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("the day as it was\n");
    rmSync(blocker, { recursive: true });
    // a rename that fails (the target is a directory) cleans its temp up
    const target = join(TMP, "failed", "folder.md");
    mkdirSync(target);
    expect(() => writeFileAtomic(target, "text")).toThrow();
    expect(readdirSync(join(TMP, "failed")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
