import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const root = join(import.meta.dir, "..");
const layerRoot = join(root, "src/assets/characters/concepts/layers");
const characterSource = readFileSync(join(root, "src/components/character.tsx"), "utf8");

const accessories = {
  glasses: [160, 108, 350, 178],
  "bucket-hat": [142, 22, 360, 146],
  goggles: [158, 58, 352, 138],
} as const;

async function alphaPixels(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: Array<{ x: number; y: number; alpha: number }> = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3] ?? 0;
      if (alpha > 0) pixels.push({ x, y, alpha });
    }
  }
  return pixels;
}

async function alphaMask(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = data[index * info.channels + 3] ?? 0;
  }
  return { alpha, width: info.width, height: info.height };
}

function inkOutsideExpandedFill(
  fill: Awaited<ReturnType<typeof alphaMask>>,
  ink: Awaited<ReturnType<typeof alphaMask>>,
  radius = 8,
) {
  expect(ink.width).toBe(fill.width);
  expect(ink.height).toBe(fill.height);

  const expanded = new Uint8Array(fill.alpha.length);
  for (let y = 0; y < fill.height; y += 1) {
    for (let x = 0; x < fill.width; x += 1) {
      if ((fill.alpha[y * fill.width + x] ?? 0) === 0) continue;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const expandedX = x + offsetX;
          const expandedY = y + offsetY;
          if (expandedX < 0 || expandedY < 0 || expandedX >= fill.width || expandedY >= fill.height) continue;
          expanded[expandedY * fill.width + expandedX] = 1;
        }
      }
    }
  }

  const outside: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < ink.height; y += 1) {
    for (let x = 0; x < ink.width; x += 1) {
      const index = y * ink.width + x;
      if ((ink.alpha[index] ?? 0) > 0 && expanded[index] !== 1) outside.push({ x, y });
    }
  }
  return outside;
}

describe("generated quokka accessory layers", () => {
  test("give the selected hue exclusive ownership of accessory fill pixels", async () => {
    for (const [accessory, [left, top, right, bottom]] of Object.entries(accessories)) {
      const fill = await alphaPixels(join(layerRoot, `${accessory}-accessory.webp`));
      const inherited = await alphaPixels(join(layerRoot, `${accessory}-accessory-detail.webp`));

      expect(fill.length).toBeGreaterThan(0);
      expect(fill.every(({ x, y }) => x >= left && x <= right && y >= top && y <= bottom)).toBeTrue();
      expect(fill.every(({ alpha }) => alpha === 255)).toBeTrue();
      expect(inherited).toHaveLength(0);
    }
  });

  test("keeps line-only companions monochrome while retaining accessory ink", async () => {
    expect(characterSource).toContain("fill &&");
    expect(characterSource).not.toContain("quokka-accessory-detail-layer");

    for (const [accessory, [left, top, right, bottom]] of Object.entries(accessories)) {
      const ink = await alphaPixels(join(layerRoot, `${accessory}-accessory-ink.webp`));
      expect(ink.length).toBeGreaterThan(0);
      expect(ink.every(({ x, y }) => x >= left && x <= right && y >= top && y <= bottom)).toBeTrue();
    }
  });

  test("keeps accessory ink attached to the accessory silhouette so moods own every facial and body line", async () => {
    for (const accessory of Object.keys(accessories)) {
      const fill = await alphaMask(join(layerRoot, `${accessory}-accessory.webp`));
      const ink = await alphaMask(join(layerRoot, `${accessory}-accessory-ink.webp`));
      const leakedInk = inkOutsideExpandedFill(fill, ink);

      expect(leakedInk, `${accessory} contains neutral-pose ink outside its accessory`).toHaveLength(0);
    }
  });
});
