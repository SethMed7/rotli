import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;

test("the native dev command uses an unmistakable identity without changing production", () => {
  const pkg = readJson("package.json") as { scripts?: Record<string, string> };
  const production = readJson("src-tauri/tauri.conf.json") as {
    productName?: string;
    bundle?: { icon?: string[] };
  };
  const development = readJson("src-tauri/tauri.dev.conf.json") as {
    productName?: string;
    bundle?: { icon?: string[] };
  };

  expect(pkg.scripts?.["dev:app"]).toBe("tauri dev --config src-tauri/tauri.dev.conf.json");
  expect(development.productName).toBe("rotli (dev)");
  expect(development.bundle?.icon).toContain("icons-dev/icon.icns");
  expect(production.productName).toBe("rotli");
  expect(production.bundle?.icon).not.toContain("icons-dev/icon.icns");
});
