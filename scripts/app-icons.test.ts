import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const root = join(import.meta.dir, "..");
const VARIANTS = ["default", "warm", "paper", "charcoal", "clay", "black", "tesven"];

async function visibleBounds(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x: number, y: number): number[] => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + info.channels)];
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if ((pixelAt(x, y)[3] ?? 0) >= 128) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return {
    size: [info.width, info.height],
    bounds: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
    pixelAt,
  };
}

// macOS draws every Dock icon from a 1024 canvas whose 824 tile leaves a ~10%
// transparent margin; a full-bleed PNG renders visibly larger than its neighbors.
test("every Dock icon variant sits on the macOS icon grid", async () => {
  for (const id of VARIANTS) {
    const icon = await visibleBounds(join(root, `src-tauri/icons/variants/${id}.png`));
    expect(icon.size).toEqual([512, 512]);
    expect(icon.bounds).toEqual([50, 461, 50, 461]);
    expect(icon.pixelAt(4, 4)[3]).toBe(0);
  }
});

test("the black variant is a pure black tile with a white quokka", async () => {
  const icon = await visibleBounds(join(root, "src-tauri/icons/variants/black.png"));
  expect(icon.pixelAt(256, 70)).toEqual([0, 0, 0, 255]);
  const inked = new Set<string>();
  for (let x = 140; x < 372; x += 1) inked.add(icon.pixelAt(x, 220).slice(0, 3).join(","));
  expect(inked.has("255,255,255")).toBe(true);
});

// Tesven's variant is Rotli's white line quokka on Tesven's One Blue field:
// a blue tile (blue well above red and green), brighter at the top right glow,
// with pure white ink on the quokka.
test("the tesven variant is the white line quokka on the One Blue field", async () => {
  const icon = await visibleBounds(join(root, "src-tauri/icons/variants/tesven.png"));
  const [r = 0, g = 0, b = 0] = icon.pixelAt(90, 420);
  expect(b).toBeGreaterThan(120);
  expect(b).toBeGreaterThan(r + 60);
  expect(b).toBeGreaterThan(g);
  const glowBlue = icon.pixelAt(400, 110)[2] ?? 0;
  expect(glowBlue).toBeGreaterThan(b);
  const inked = new Set<string>();
  for (let x = 140; x < 372; x += 1) inked.add(icon.pixelAt(x, 220).slice(0, 3).join(","));
  expect(inked.has("255,255,255")).toBe(true);
});

test("every variant is wired into the native shell and the Settings picker", async () => {
  const native = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  for (const id of VARIANTS.filter((v) => v !== "default")) {
    expect(native).toContain(`"${id}" => Some(include_bytes!("../icons/variants/${id}.png"))`);
  }
  const settings = readFileSync(join(root, "src/components/settings/appIconSettings.tsx"), "utf8");
  for (const id of ["default", "paper", "charcoal", "clay", "black", "tesven"]) {
    expect(settings).toContain(`../../assets/appIcons/${id}.png`);
  }
});
