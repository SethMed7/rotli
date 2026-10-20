import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "breve-paths-"));
const PATHS = join(import.meta.dir, "../scripts/paths.ts");

/** Run `code` in a fresh Bun process so paths.ts resolves the temp storage root. */
function run(store: string, code: string): void {
  const proc = Bun.spawnSync(["bun", "-e", code], {
    env: {
      ...process.env,
      BREVE_STORAGE: store,
      BREVE_CONFIG: join(TMP, "missing-config.json"),
      ROTLI_BREVE_HOME: join(TMP, "home"),
    },
    stderr: "pipe",
  });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
}

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("breve storage lanes", () => {
  test("importing paths creates no folders", () => {
    const store = join(TMP, "import-only");
    run(store, `await import(${JSON.stringify(PATHS)});`);
    expect(existsSync(store)).toBe(false);
  });

  test("ensureBreveStorage creates every lane", () => {
    const store = join(TMP, "ensured");
    run(store, `(await import(${JSON.stringify(PATHS)})).ensureBreveStorage();`);
    expect(readdirSync(store).sort()).toEqual([
      "breveAudios",
      "breveCaptures",
      "brevePDFs",
      "breveTopics",
      "breveViews",
    ]);
  });
});
