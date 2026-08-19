import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import sharp from "sharp";

const root = join(import.meta.dir, "..");
const sourceDir = join(root, "src/assets/characters");
const outputRoot = join(sourceDir, "filled");
const maskRoot = join(sourceDir, "masks");
const conceptSourceRoot = join(sourceDir, "concepts/source");
const conceptOutputRoot = join(sourceDir, "concepts/layers");
const size = 512;
const accessorySources = new Set(["glasses", "bucket-hat", "goggles"]);
const accessoryBounds = {
  glasses: [160, 108, 350, 178],
  "bucket-hat": [142, 22, 360, 146],
  goggles: [158, 58, 352, 138],
};

const variants = [
  { name: "cocoa", fill: [198, 132, 95] },
  { name: "green", fill: [111, 166, 139] },
];

const sources = (await readdir(sourceDir))
  .filter((name) => name.endsWith(".svg") && !name.startsWith("_"))
  .sort();

async function fillCharacter(sourceName, variant) {
  const { data: lineArt, info } = await sharp(join(sourceDir, sourceName))
    .resize(size, size, { fit: "contain" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const exterior = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const alphaAt = (index) => lineArt[index * channels + 3];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (exterior[index] || alphaAt(index) > 16) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };

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

  const output = Buffer.alloc(lineArt.length);
  const [fillRed, fillGreen, fillBlue] = variant.fill;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const sourceAlpha = lineArt[offset + 3] / 255;
    if (exterior[index] === 1) {
      output[offset] = lineArt[offset];
      output[offset + 1] = lineArt[offset + 1];
      output[offset + 2] = lineArt[offset + 2];
      output[offset + 3] = lineArt[offset + 3];
      continue;
    }
    output[offset] = Math.round(lineArt[offset] * sourceAlpha + fillRed * (1 - sourceAlpha));
    output[offset + 1] = Math.round(lineArt[offset + 1] * sourceAlpha + fillGreen * (1 - sourceAlpha));
    output[offset + 2] = Math.round(lineArt[offset + 2] * sourceAlpha + fillBlue * (1 - sourceAlpha));
    output[offset + 3] = 255;
  }

  const outputDir = join(outputRoot, variant.name);
  await mkdir(outputDir, { recursive: true });
  await sharp(output, { raw: { width, height, channels } })
    .webp({ lossless: true, effort: 6 })
    .toFile(join(outputDir, `${basename(sourceName, ".svg")}.webp`));

  if (variant.name === variants[0]?.name) {
    const mask = Buffer.alloc(lineArt.length);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * channels;
      mask[offset] = 255;
      mask[offset + 1] = 255;
      mask[offset + 2] = 255;
      mask[offset + 3] = exterior[index] === 0 ? 255 : 0;
    }
    await mkdir(maskRoot, { recursive: true });
    await sharp(mask, { raw: { width, height, channels } })
      .webp({ lossless: true, effort: 6 })
      .toFile(join(maskRoot, `${basename(sourceName, ".svg")}.webp`));
  }
}

function hueOf(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

function insetOpaqueMask(source, width, height, channels, radius = 2) {
  const output = Buffer.alloc(source.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let keep = true;
      for (let offsetY = -radius; offsetY <= radius && keep; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const neighbor = ((y + offsetY) * width + x + offsetX) * channels;
          if ((source[neighbor + 3] ?? 0) < 128) {
            keep = false;
            break;
          }
        }
      }
      if (!keep) continue;
      const offset = (y * width + x) * channels;
      output[offset] = 255;
      output[offset + 1] = 255;
      output[offset + 2] = 255;
      output[offset + 3] = 255;
    }
  }
  return output;
}

function dilateOpaqueMask(source, width, height, channels, radius = 2) {
  const output = Buffer.alloc(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let keep = false;
      for (let offsetY = -radius; offsetY <= radius && !keep; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
          const neighbor = (neighborY * width + neighborX) * channels;
          if ((source[neighbor + 3] ?? 0) >= 128) {
            keep = true;
            break;
          }
        }
      }
      if (!keep) continue;
      const offset = (y * width + x) * channels;
      output[offset] = 255;
      output[offset + 1] = 255;
      output[offset + 2] = 255;
      output[offset + 3] = 255;
    }
  }
  return output;
}

function outlineOpaqueMask(source, width, height, channels, radius = 2) {
  const outer = dilateOpaqueMask(source, width, height, channels, radius);
  const inner = insetOpaqueMask(source, width, height, channels, radius);
  const output = Buffer.alloc(source.length);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    if ((outer[offset + 3] ?? 0) === 0 || (inner[offset + 3] ?? 0) > 0) continue;
    output[offset] = 255;
    output[offset + 1] = 255;
    output[offset + 2] = 255;
    output[offset + 3] = 255;
  }
  return output;
}

function paintOpaquePixel(target, width, height, channels, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * channels;
  target[offset] = 255;
  target[offset + 1] = 255;
  target[offset + 2] = 255;
  target[offset + 3] = 255;
}

/** The source glasses are clear black frames, so color segmentation cannot
 * distinguish their transparent lenses from the face beneath them. Rebuild
 * the same two-ring silhouette explicitly instead of inheriting the source
 * quokka's pupils and nose as accessory geometry. */
function buildGlassesSilhouette(width, height, channels) {
  const output = Buffer.alloc(width * height * channels);
  const lenses = [
    { centerX: 216, centerY: 144 },
    { centerX: 296, centerY: 144 },
  ];
  for (const { centerX, centerY } of lenses) {
    for (let y = centerY - 27; y <= centerY + 27; y += 1) {
      for (let x = centerX - 34; x <= centerX + 34; x += 1) {
        const outer = Math.hypot((x - centerX) / 34, (y - centerY) / 27);
        const inner = Math.hypot((x - centerX) / 25, (y - centerY) / 18);
        if (outer <= 1 && inner >= 1) paintOpaquePixel(output, width, height, channels, x, y);
      }
    }
  }
  for (let y = 139; y <= 149; y += 1) {
    for (let x = 181; x <= 331; x += 1) {
      const isBridge = x >= 247 && x <= 265;
      const isLeftTemple = x <= 184;
      const isRightTemple = x >= 328;
      if (isBridge || isLeftTemple || isRightTemple) paintOpaquePixel(output, width, height, channels, x, y);
    }
  }
  return output;
}

function isAccessoryColor(stem, red, green, blue, saturation, hue) {
  switch (stem) {
    case "bucket-hat":
      return red > 150 && green > 105 && blue < 110 && saturation > 0.28 && hue >= 32 && hue <= 55;
    case "goggles":
      return blue > 150 && blue > red + 35 && green > 125;
    default:
      return false;
  }
}

/** Split approved raster concepts into independently owned body, ink, and
 * accessory masks. Accessory color is inset beneath its line work so source
 * anti-aliasing cannot leave a colored fringe outside the drawing. */
async function buildConceptLayers(sourceName) {
  const { data, info } = await sharp(join(conceptSourceRoot, sourceName))
    .resize(size, size, { fit: "contain" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const body = Buffer.alloc(data.length);
  const line = Buffer.alloc(data.length);
  let accessory = Buffer.alloc(data.length);
  const accessoryDetail = Buffer.alloc(data.length);
  const detail = Buffer.alloc(data.length);
  const stem = basename(sourceName, ".png");

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha === 0) continue;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const hue = hueOf(red, green, blue);
    const isLine = max < 92;
    const isBody = !isLine && red > 105 && blue > 70 && saturation > 0.2 && hue <= 32;
    const x = index % width;
    const y = Math.floor(index / width);
    const bounds = accessoryBounds[stem];
    const insideAccessory = bounds && x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
    const isAccessory =
      accessorySources.has(stem) &&
      insideAccessory &&
      !isLine &&
      isAccessoryColor(stem, red, green, blue, saturation, hue);
    const target = isAccessory ? accessory : isBody ? body : isLine ? line : detail;

    if (target === detail) {
      target[offset] = red;
      target[offset + 1] = green;
      target[offset + 2] = blue;
    } else {
      target[offset] = 255;
      target[offset + 1] = 255;
      target[offset + 2] = 255;
    }
    target[offset + 3] = alpha;

  }

  if (stem === "glasses") accessory = buildGlassesSilhouette(width, height, channels);
  const accessoryFill = insetOpaqueMask(accessory, width, height, channels);
  const accessoryInk = outlineOpaqueMask(accessoryFill, width, height, channels);

  await mkdir(conceptOutputRoot, { recursive: true });
  await Promise.all(
    [
      { layer: "body", pixels: body },
      { layer: "line", pixels: line },
      { layer: "accessory", pixels: accessoryFill },
      { layer: "accessory-ink", pixels: accessoryInk },
      { layer: "accessory-detail", pixels: accessoryDetail },
      { layer: "detail", pixels: detail },
    ].map(({ layer, pixels }) =>
      sharp(pixels, { raw: { width, height, channels } })
        .webp({ lossless: true, effort: 6 })
        .toFile(join(conceptOutputRoot, `${stem}-${layer}.webp`)),
    ),
  );
}

for (const sourceName of sources) {
  for (const variant of variants) await fillCharacter(sourceName, variant);
}

const conceptSources = (await readdir(conceptSourceRoot)).filter((name) => name.endsWith(".png")).sort();
for (const sourceName of conceptSources) await buildConceptLayers(sourceName);

console.log(
  `Built ${sources.length * variants.length} canonical fills, ${sources.length} masks, and ${conceptSources.length * 6} concept layers.`,
);
