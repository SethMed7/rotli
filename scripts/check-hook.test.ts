import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The pre-commit hook is bash, so it is tested by running it — against a real
 * throwaway repo with real staged blobs, because the bug this guards against
 * only appears with a real `git show` pipeline.
 *
 * The bug (2026-08-07): the conflict-marker check used `grep -q` under
 * `set -o pipefail`. `-q` exits on first match, `git show` dies of SIGPIPE, and
 * pipefail turns the successful match into a non-zero pipeline — so a found
 * marker read as clean on any file large enough to still be writing. Measured:
 * caught at 32KB and 64KB, MISSED at 128KB and above. That silently exempted
 * the repo's biggest and most merge-prone files. */

const HOOK = join(import.meta.dir, "..", ".githooks", "pre-commit");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function repoWith(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rotli-hook-"));
  git(dir, "init", "-q", ".");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "test");
  writeFileSync(join(dir, name), body);
  git(dir, "add", "-A");
  return dir;
}

/** Returns true when the hook REJECTED the staged content. */
function hookRejects(dir: string): boolean {
  try {
    execFileSync("bash", [HOOK], { cwd: dir, encoding: "utf8", stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

describe("pre-commit conflict-marker guard", () => {
  // 1 KiB is comfortably under any pipe buffer; 256 KiB is comfortably over.
  // The regression lives entirely in the large case — the small one passed even
  // while the guard was broken, which is exactly why it went unnoticed.
  test.each([
    ["small (1 KiB)", 1],
    ["large (256 KiB) — the size that used to slip through", 256],
  ])("catches a conflict marker in a %s file", (_label, kib) => {
    const dir = repoWith("note.md", `<<<<<<< HEAD\n${"a".repeat(kib * 1024)}\n`);
    try {
      expect(hookRejects(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lets clean content through at the size that used to slip", () => {
    const dir = repoWith("note.md", `${"a".repeat(256 * 1024)}\n`);
    try {
      expect(hookRejects(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a bare <<<<<<< with no trailing space or EOL is not a marker", () => {
    // The pattern requires `( |$)` so a run of angle brackets inside prose or a
    // fixture does not trip the guard.
    const dir = repoWith("note.md", "<<<<<<<not-a-marker\n");
    try {
      expect(hookRejects(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
