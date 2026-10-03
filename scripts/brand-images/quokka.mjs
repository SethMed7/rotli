// The quokka for brand images: the line art in src/assets/characters/ over the
// app's Cocoa body (scripts/build-character-fills.mjs fills the same way), at
// whatever size an image needs, with the eye and nose highlights kept light.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const root = join(import.meta.dir, "../..");
const COCOA = [198, 132, 95];
const HIGHLIGHT = [255, 250, 242];

/**
 * A filled quokka: `uri` (a PNG data URI) and `box`, its visible bounds as
 * fractions of the square (what brand images keep text clear of).
 *   pose      a file in src/assets/characters/ without `.svg` (`_logo` is the face mark)
 *   size      the square raster size in pixels
 *   viewBox   an optional crop of the drawing (the face mark is cropped at its shoulders)
 *   openBottom  when the crop cuts the drawing at the bottom edge, the body is open there:
 *               flood the outside from the top and sides only, so the body still fills
 *   ink       the line color (the drawings use currentColor)
 */
export async function quokka(pose, { size, viewBox, openBottom = false, ink = "#3a3028" }) {
  let svg = (await readFile(join(root, "src/assets/characters", `${pose}.svg`), "utf8")).replaceAll(
    "currentColor",
    ink,
  );
  if (viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  const box = (svg.match(/viewBox="([^"]*)"/)?.[1] ?? "0 0 1024 1024").split(/[\s,]+/).map(Number);
  const density = (72 * size) / Math.max(box[2] ?? 1024, box[3] ?? 1024);
  const { data, info } = await sharp(Buffer.from(svg), { density })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const count = width * height;
  // 0 = not yet reached, 1 = outside the drawing, 2+ = an enclosed region's label.
  const region = new Int32Array(count);
  const queue = new Int32Array(count);
  const open = (index) => data[index * channels + 3] <= 16;
  const flood = (seeds, label) => {
    let head = 0;
    let tail = 0;
    for (const seed of seeds) {
      if (region[seed] === 0 && open(seed)) {
        region[seed] = label;
        queue[tail++] = seed;
      }
    }
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      for (const next of [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        index - width,
        index + width,
      ]) {
        if (next < 0 || next >= count || region[next] !== 0 || !open(next)) continue;
        region[next] = label;
        queue[tail++] = next;
      }
    }
    return tail;
  };
  const edge = [];
  for (let x = 0; x < width; x += 1) {
    edge.push(x);
    if (!openBottom) edge.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) edge.push(y * width, y * width + width - 1);
  flood(edge, 1);
  // Small enclosed openings are the eye and nose highlights: they stay light.
  const small = new Set();
  let label = 2;
  for (let index = 0; index < count; index += 1) {
    if (region[index] !== 0 || !open(index)) continue;
    if (flood([index], label) < count * 0.0012) small.add(label);
    label += 1;
  }
  const out = Buffer.alloc(count * 4);
  for (let index = 0; index < count; index += 1) {
    const source = index * channels;
    const target = index * 4;
    const alpha = data[source + 3] / 255;
    if (region[index] === 1) {
      out.set([data[source], data[source + 1], data[source + 2], data[source + 3]], target);
      continue;
    }
    const fill = small.has(region[index]) ? HIGHLIGHT : COCOA;
    for (let c = 0; c < 3; c += 1)
      out[target + c] = Math.round(data[source + c] * alpha + fill[c] * (1 - alpha));
    out[target + 3] = 255;
  }
  let [left, top, right, bottom] = [width, height, 0, 0];
  for (let index = 0; index < count; index += 1) {
    if (out[index * 4 + 3] <= 16) continue;
    const x = index % width;
    const y = (index - x) / width;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  const png = await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return {
    uri: `data:image/png;base64,${png.toString("base64")}`,
    box: { left: left / width, top: top / height, right: right / width, bottom: bottom / height },
  };
}
