import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function run(binary: string, arguments_: string[], options: { cwd?: string; stdin?: string } = {}) {
  const child = Bun.spawn([binary, ...arguments_], {
    cwd: options.cwd ?? root,
    env: process.env,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("Oxc executable contracts", () => {
  test("the root oxlint config executes a tsgolint type-aware rule", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rotli-oxlint-contract-"));
    try {
      const source = join(directory, "floating.ts");
      const tsconfig = join(directory, "tsconfig.json");
      await Promise.all([
        writeFile(source, "Promise.resolve(1);\n"),
        writeFile(
          tsconfig,
          `${JSON.stringify({ compilerOptions: { strict: true }, include: ["floating.ts"] }, null, 2)}\n`,
        ),
      ]);

      const result = await run(join(root, "node_modules/oxlint/bin/oxlint"), [
        "--disable-nested-config",
        "-c",
        join(root, ".oxlintrc.json"),
        "--tsconfig",
        tsconfig,
        source,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("no-floating-promises");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("the root oxfmt config controls stdin formatting and import sorting", async () => {
    const result = await run(
      join(root, "node_modules/oxfmt/bin/oxfmt"),
      ["-c", join(root, ".oxfmtrc.json"), "--stdin-filepath", join(root, "scripts/fixture.ts")],
      { stdin: 'import z from "z";\nimport a from "a";\nconst answer=1\n' },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("const answer = 1;");
    expect(result.stdout.indexOf('from "a"')).toBeLessThan(result.stdout.indexOf('from "z"'));
  });
});
