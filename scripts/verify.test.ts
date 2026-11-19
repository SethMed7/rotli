import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runVerify(lanes: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "rotli-verify-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    copyFileSync(new URL("./verify.sh", import.meta.url), join(root, "scripts/verify.sh"));
    const log = join(root, "commands.log");
    writeFileSync(log, "");
    for (const name of ["bun", "bunx", "cargo", "git"]) {
      writeFileSync(
        join(root, "bin", name),
        `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "$VERIFY_TEST_LOG"\n${name === "git" ? "exit 1" : "exit 0"}\n`,
        { mode: 0o755 },
      );
    }
    const result = Bun.spawnSync(["bash", join(root, "scripts/verify.sh"), ...lanes], {
      env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, VERIFY_TEST_LOG: log },
    });
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
      commands: readFileSync(log, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each([{ lanes: ["qualty"] }, { lanes: ["rust", "unknown"] }, { lanes: ["--help"] }])(
  "verify rejects invalid lanes before running any command: $lanes",
  ({ lanes }) => {
    const result = runVerify(lanes);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Usage:");
    expect(result.output).not.toContain("verify passed");
    expect(result.commands).toBe("");
  },
);

test("a recognized lane still runs its checks", () => {
  const result = runVerify(["rust"]);
  expect(result.code).toBe(0);
  expect(result.commands).toContain("cargo clippy");
  expect(result.commands).toContain("cargo test");
  // its one bun step: the save queue against the real Rust write lane
  expect(result.commands.split("\n").filter((line) => line.startsWith("bun "))).toEqual([
    "bun run test:write-lane",
  ]);
  expect(result.output).toContain("verify passed");
});
