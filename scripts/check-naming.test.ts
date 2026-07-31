import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checker = join(import.meta.dir, "check-naming.mjs");

async function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "rotli-naming-"));
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

describe("naming checker", () => {
  test("accepts the allowed variable casings, discards, and dunder build globals", async () => {
    const result = await fixture({
      "src/ok.ts": [
        "const plainCamel = 1;",
        "const UPPER_CASE_CONST = 2;",
        "const PascalComponent = 3;",
        "const _discard = 4;",
        "declare const __APP_VERSION__: string;",
        "const { fromPattern, nested: renamedHere } = { fromPattern: 1, nested: 2 };",
        "export const total = plainCamel + UPPER_CASE_CONST + PascalComponent + _discard + fromPattern + renamedHere;",
      ].join("\n"),
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("check:naming ok");
  });

  test("rejects snake_case variables, including inside binding patterns", async () => {
    const result = await fixture({
      "src/bad.ts":
        "const snake_case = 1;\nconst { also_bad } = { also_bad: 2 };\nexport const sum = snake_case + also_bad;\n",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("src/bad.ts:1 variable `snake_case`");
    expect(result.stderr).toContain("src/bad.ts:2 variable `also_bad`");
  });

  test("rejects non-PascalCase type-likes and I-prefixed interfaces", async () => {
    const result = await fixture({
      "src/types.ts": [
        "interface IWidget { id: string }",
        "type badAlias = number;",
        "enum badEnum { One }",
        "class badClass<t> { value?: t }",
        "export const keep: IWidget | badAlias | badEnum | badClass<number> | null = null;",
      ].join("\n"),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("interface `IWidget` must not use the I-prefix");
    expect(result.stderr).toContain("type alias `badAlias` must be PascalCase");
    expect(result.stderr).toContain("enum `badEnum` must be PascalCase");
    expect(result.stderr).toContain("class `badClass` must be PascalCase");
    expect(result.stderr).toContain("type parameter `t` must be PascalCase");
  });

  test("ignores files outside src/", async () => {
    const result = await fixture({
      "scripts/tool.ts": "const not_checked = 1;\nexport const value = not_checked;\n",
    });
    expect(result.code).toBe(0);
  });
});
