import { mkdir, readdir } from "node:fs/promises";
import { basename } from "node:path";

import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../src/assets/characters/celebrating.svg", import.meta.url));
const sourceDir = fileURLToPath(new URL("../../../src/assets/characters/", import.meta.url));
const maskDir = fileURLToPath(new URL("assets/quokka-masks/", import.meta.url));
const size = 1254;
const maskSize = 512;

const variants = [
  { name: "quokka-canonical-cocoa.png", fill: [198, 132, 95] },
  { name: "quokka-canonical-green.png", fill: [111, 166, 139] },
];

const { data: lineArt, info } = await sharp(source)
  .resize(size, size, { fit: "contain" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
const exterior = new Uint8Array(width * height);
const queue = new Int32Array(width * height);
let head = 0;
let tail = 0;

function alphaAt(index) {
  return lineArt[index * channels + 3];
}

function visit(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = y * width + x;
  if (exterior[index] || alphaAt(index) > 16) return;
  exterior[index] = 1;
  queue[tail++] = index;
}

for (let x = 0; x < width; x += 1) {
  visit(x, 0);
  visit(x, height - 1);
}
for (let y = 0; y < height; y += 1) {
  visit(0, y);
  visit(width - 1, y);
}

while (head < tail) {
  const index = queue[head++];
  const x = index % width;
  const y = Math.floor(index / width);
  visit(x - 1, y);
  visit(x + 1, y);
  visit(x, y - 1);
  visit(x, y + 1);
}

for (const variant of variants) {
  const output = Buffer.alloc(lineArt.length);
  const [fillRed, fillGreen, fillBlue] = variant.fill;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const sourceAlpha = lineArt[offset + 3] / 255;
    const isInterior = exterior[index] === 0;

    if (!isInterior) {
      output[offset] = lineArt[offset];
      output[offset + 1] = lineArt[offset + 1];
      output[offset + 2] = lineArt[offset + 2];
      output[offset + 3] = lineArt[offset + 3];
      continue;
    }

    output[offset] = Math.round(lineArt[offset] * sourceAlpha + fillRed * (1 - sourceAlpha));
    output[offset + 1] = Math.round(
      lineArt[offset + 1] * sourceAlpha + fillGreen * (1 - sourceAlpha),
    );
    output[offset + 2] = Math.round(
      lineArt[offset + 2] * sourceAlpha + fillBlue * (1 - sourceAlpha),
    );
    output[offset + 3] = 255;
  }

  await sharp(output, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(fileURLToPath(new URL(`assets/${variant.name}`, import.meta.url)));
}

await mkdir(maskDir, { recursive: true });

async function buildMask(sourceName) {
  const { data, info: maskInfo } = await sharp(`${sourceDir}${sourceName}`)
    .resize(maskSize, maskSize, { fit: "contain" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskExterior = new Uint8Array(maskInfo.width * maskInfo.height);
  const maskQueue = new Int32Array(maskInfo.width * maskInfo.height);
  let maskHead = 0;
  let maskTail = 0;
  const maskAlphaAt = (index) => data[index * maskInfo.channels + 3];
  const maskVisit = (x, y) => {
    if (x < 0 || y < 0 || x >= maskInfo.width || y >= maskInfo.height) return;
    const index = y * maskInfo.width + x;
    if (maskExterior[index] || maskAlphaAt(index) > 16) return;
    maskExterior[index] = 1;
    maskQueue[maskTail++] = index;
  };

  for (let x = 0; x < maskInfo.width; x += 1) {
    maskVisit(x, 0);
    maskVisit(x, maskInfo.height - 1);
  }
  for (let y = 0; y < maskInfo.height; y += 1) {
    maskVisit(0, y);
    maskVisit(maskInfo.width - 1, y);
  }
  while (maskHead < maskTail) {
    const index = maskQueue[maskHead++];
    const x = index % maskInfo.width;
    const y = Math.floor(index / maskInfo.width);
    maskVisit(x - 1, y);
    maskVisit(x + 1, y);
    maskVisit(x, y - 1);
    maskVisit(x, y + 1);
  }

  const mask = Buffer.alloc(maskInfo.width * maskInfo.height * 4);
  for (let index = 0; index < maskInfo.width * maskInfo.height; index += 1) {
    const offset = index * 4;
    mask[offset] = 255;
    mask[offset + 1] = 255;
    mask[offset + 2] = 255;
    mask[offset + 3] = maskExterior[index] === 0 ? 255 : 0;
  }

  await sharp(mask, {
    raw: { width: maskInfo.width, height: maskInfo.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(`${maskDir}${basename(sourceName, ".svg")}.png`);
}

const maskSources = (await readdir(sourceDir))
  .filter((name) => name.endsWith(".svg") && !name.startsWith("_"))
  .sort();
for (const sourceName of maskSources) await buildMask(sourceName);

console.log(
  `Built ${variants.length} canonical fills and ${maskSources.length} browser-tint masks.`,
);
