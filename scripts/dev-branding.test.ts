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
  // UAT: the same supervised dev app, gated exactly like a public release
  expect(pkg.scripts?.["dev:uat"]).toBe(
    "ROTLI_BUILD_CHANNEL=stable bun --no-orphans scripts/tauri-dev-supervisor.ts",
  );
  expect(development.productName).toBe("Rotli (Dev)");
  expect(development.bundle?.icon).toContain("icons-dev/icon.icns");
  expect(production.productName).toBe("rotli");
  expect(production.bundle?.icon).not.toContain("icons-dev/icon.icns");
});

// The bundle, binary and update archive keep the lowercase `rotli` name that
// release.sh, the updater feed and `rotli` CLI paths depend on; only the name
// macOS shows (Dock, app menu, Finder) is capitalised, through a merged plist.
test("macOS shows the app as Rotli, and the dev build as Rotli (Dev)", () => {
  const plistName = (path: string, key: string): string | undefined =>
    new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(
      readFileSync(join(root, path), "utf8"),
    )?.[1];
  const production = readJson("src-tauri/tauri.conf.json") as {
    app?: { windows?: { title?: string }[] };
    bundle?: { macOS?: { infoPlist?: string } };
  };
  const development = readJson("src-tauri/tauri.dev.conf.json") as {
    bundle?: { macOS?: { infoPlist?: string } };
  };
  const productionPlist = `src-tauri/${production.bundle?.macOS?.infoPlist}`;
  const developmentPlist = `src-tauri/${development.bundle?.macOS?.infoPlist}`;

  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    expect(plistName(productionPlist, key)).toBe("Rotli");
    expect(plistName(developmentPlist, key)).toBe("Rotli (Dev)");
  }
  expect(production.app?.windows?.[0]?.title).toBe("Rotli");
  expect(readFileSync(join(root, "index.html"), "utf8")).toContain("<title>Rotli</title>");
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
      if ((alpha ?? 0) >= 128) visiblePixels.push([x, y]);
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
  // the vault actions live beside actions.ts, which registers them
  const actionsSource = readFileSync(join(root, "src/keys/vaultActions.ts"), "utf8");
  expect(readFileSync(join(root, "src/keys/actions.ts"), "utf8")).toContain("registerVaultActions()");
  expect(actionsSource).toContain('id: "vault.refresh"');
  expect(actionsSource).toContain('defaultChord: "Meta+R"');
  expect(actionsSource).toContain("reconnectActiveVault()");
  expect(actionsSource).not.toContain("window.location.reload()");
});
