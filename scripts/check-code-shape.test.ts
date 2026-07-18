import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checker = join(import.meta.dir, "check-code-shape.mjs");

async function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "rotli-code-shape-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, source);
  }
  const proc = Bun.spawn([process.execPath, checker], {
    env: { ...process.env, ROTLI_CHECK_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("code-shape checker", () => {
  test("accepts an acyclic production graph and ordinary tests", async () => {
    const result = await fixture({
      "src/model.ts": "export const value = 1;\n",
      "src/workflow.ts": "import { value } from './model'; export const result = value;\n",
      "src/workflow.test.ts": "test('works', () => {});\n",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("cycle-free");
  });

  test("rejects production import cycles", async () => {
    const result = await fixture({
      "src/one.ts": "import './two';\n",
      "src/two.ts": "import './one';\n",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("module cycle");
  });

  test("rejects focused tests and hidden type errors", async () => {
    const result = await fixture({
      "src/unsafe.ts": "// @ts-" + "ignore\nexport const value: number = 'wrong';\n",
      "src/unsafe.test.ts": "test" + ".only('focused', () => {});\n",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("focused or skipped tests");
    expect(result.stderr).toContain("@ts-ignore");
  });
});
