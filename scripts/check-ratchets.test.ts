// check:ratchets is a gate; a gate needs its own failing cases. Each fixture
// is a temp tree with its own baseline, driven through ROTLI_CHECK_ROOT.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checker = join(import.meta.dir, "check-ratchets.mjs");

async function run(files: Record<string, string>, args: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "rotli-ratchets-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, source);
  }
  const proc = Bun.spawn([process.execPath, checker, ...args], {
    env: { ...process.env, ROTLI_CHECK_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { root, stdout, stderr, code };
}

const big = (n: number) =>
  Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
const baseline = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    fileLines: { "src/big.ts": 650 },
    sourceShapeAssertions: 2,
    provenanceComments: { maintainerDated: 0, phaseOrIncrement: 0 },
    coverage: {},
    ...extra,
  });

describe("check:ratchets", () => {
  test("holds when every number is at or under its ceiling", async () => {
    const r = await run({
      "scripts/ratchet-baseline.json": baseline(),
      "src/big.ts": big(640),
      "src/shape.test.ts":
        'readFileSync(new URL("x"));\nexpect(a).toContain("b");\nexpect(a).toMatch(/c/);\n',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("check:ratchets ok");
  });

  test("a file growing past its ceiling fails, and a shrink does not silently lower it", async () => {
    const r = await run({ "scripts/ratchet-baseline.json": baseline(), "src/big.ts": big(660) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("src/big.ts: 661 lines exceeds its 650-line ceiling");

    const shrunk = await run({ "scripts/ratchet-baseline.json": baseline(), "src/big.ts": big(610) });
    expect(shrunk.code).toBe(0);
    const stored = (await Bun.file(join(shrunk.root, "scripts/ratchet-baseline.json")).json()) as {
      fileLines: Record<string, number>;
    };
    expect(stored.fileLines["src/big.ts"]).toBe(650); // only --update moves it
  });

  test("one more source-string assertion in an existing shape file fails", async () => {
    const r = await run({
      "scripts/ratchet-baseline.json": baseline(),
      "src/big.ts": big(600),
      "src/shape.test.ts":
        'const s = readFileSync(\n  new URL("x"));\nexpect(s).toContain("a");\nexpect(s).not.toContain("b");\nexpect(s).toMatch(/c/);\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("source-shape test assertions rose to 3 (ceiling 2)");
  });

  test("a directory sinking below its recorded coverage ratio fails", async () => {
    const files: Record<string, string> = {
      "scripts/ratchet-baseline.json": baseline({ coverage: { "src/thin": 0.5 } }),
      "src/big.ts": big(600),
    };
    for (let i = 0; i < 10; i++) files[`src/thin/m${i}.ts`] = "export {};\n";
    files["src/thin/m0.test.ts"] = "";
    const r = await run(files);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("src/thin: 0.1 test files per module, below its 0.5 floor");
  });
});
