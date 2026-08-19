import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { budgetRegressions } from "./check-react-compiler.mjs";

const checker = join(import.meta.dir, "check-react-compiler.mjs");
const repositoryRoot = join(import.meta.dir, "..");

async function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), "rotli-react-compiler-"));
  mkdirSync(join(root, "src"), { recursive: true });
  await Bun.write(join(root, "src/component.tsx"), source);
  const baseline = join(root, "baseline.json");
  await Bun.write(baseline, "{}\n");
  const proc = Bun.spawn([process.execPath, checker], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ROTLI_REACT_COMPILER_REPOSITORY_ROOT: repositoryRoot,
      ROTLI_REACT_COMPILER_ROOT: root,
      ROTLI_REACT_COMPILER_BASELINE: baseline,
    },
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

describe("React Compiler policy checker", () => {
  test("accepts a compiler-safe component", async () => {
    const result = await fixture("export function Greeting() { return <p>Hello</p>; }\n");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0 new");
  });

  test("rejects a new synchronous state update in an effect", async () => {
    const result = await fixture(
      [
        'import { useEffect, useState } from "react";',
        "export function Derived({ value }: { value: string }) {",
        '  const [copy, setCopy] = useState("");',
        "  useEffect(() => setCopy(value), [value]);",
        "  return <p>{copy}</p>;",
        "}",
      ].join("\n"),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("EffectSetState");
  });

  test("allows debt to shrink but rejects a per-file diagnostic increase", () => {
    expect(
      budgetRegressions(
        { "src/a.tsx": { Refs: 1 } },
        { "src/a.tsx": { Refs: 2 }, "src/old.tsx": { Purity: 1 } },
      ),
    ).toEqual([]);
    expect(budgetRegressions({ "src/a.tsx": { Refs: 3 } }, { "src/a.tsx": { Refs: 2 } })).toEqual([
      { file: "src/a.tsx", kind: "Refs", count: 3, allowed: 2 },
    ]);
  });
});
