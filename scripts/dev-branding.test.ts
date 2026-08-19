import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

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

  expect(pkg.scripts?.["dev:app"]).toBe("bun --no-orphans scripts/tauri-dev-supervisor.ts");
  expect(development.productName).toBe("rotli (dev)");
  expect(development.bundle?.icon).toContain("icons-dev/icon.icns");
  expect(production.productName).toBe("rotli");
  expect(production.bundle?.icon).not.toContain("icons-dev/icon.icns");
});

test("the development icon uses Rotli's blue identity", async () => {
  const icon = sharp(join(root, "src-tauri/icons-dev/icon.png"));
  const { data, info } = await icon.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x: number, y: number): number[] => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + info.channels)];
  };

  expect([info.width, info.height]).toEqual([512, 512]);
  expect(pixelAt(256, 170)).toEqual([47, 111, 174, 255]);
  expect(pixelAt(256, 256)).toEqual([248, 242, 233, 255]);

  const runtime = await sharp(join(root, "src-tauri/icons-dev/runtime.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const visiblePixels: Array<[number, number]> = [];
  for (let y = 0; y < runtime.info.height; y += 1) {
    for (let x = 0; x < runtime.info.width; x += 1) {
      const alpha = runtime.data[(y * runtime.info.width + x) * runtime.info.channels + 3];
      if (alpha >= 128) visiblePixels.push([x, y]);
    }
  }
  const xs = visiblePixels.map(([x]) => x);
  const ys = visiblePixels.map(([, y]) => y);
  expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([48, 462, 48, 462]);

  const nativeSource = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  expect(nativeSource).toContain('include_bytes!("../icons-dev/runtime.png")');
  expect(nativeSource).toContain("#[cfg(debug_assertions)]");
});

test("Command-R refreshes the current vault without reloading the webview", () => {
  const actionsSource = readFileSync(join(root, "src/keys/actions.ts"), "utf8");
  expect(actionsSource).toContain('id: "vault.refresh"');
  expect(actionsSource).toContain('defaultChord: "Meta+R"');
  expect(actionsSource).toContain("reconnectActiveVault()");
  expect(actionsSource).not.toContain("window.location.reload()");
});
