// The quokka for brand images: the app's canonical line art in src/assets/characters/, filled
// the way scripts/build-character-fills.mjs fills the site's poses (the Cocoa body under the
// ink), with two differences that matter at picture size:
//   - the eye and nose highlights stay light, and
//   - what the quokka holds is painted as the scene paints its props (paper pages, a wood
//     folder, a glass lens) instead of disappearing into the body colour.
// The fill always runs at the drawing's own resolution (1254 px, or a multiple for big
// images), so the paint seeds below land in the same regions at every output size, and the
// result is then resized: crisp from a 300 px grid tile to a 2400 px banner.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import { C } from "./templates.mjs";

const root = join(import.meta.dir, "../..");
/** The drawings' side, in art units (their viewBox). */
export const ART = 1254;
/** The drawings' line weight, in art units: the ink a prop beside the quokka should match. */
export const ART_LINE = 15;
const COCOA = [198, 132, 95];
const HIGHLIGHT = [255, 250, 242];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * What each pose holds, painted in the scenes' palette: points in art units, each inside one
 * enclosed region of the drawing (found with a labelled region map). A seed that lands on ink
 * or outside the character stops the build, so a redrawn pose cannot silently paint its body.
 */
export const POSE_PAINT = {
  notes: [{ at: [628, 760], fill: C.paper }],
  stays_local: [
    { at: [542, 614], fill: C.paper },
    { at: [618, 626], fill: C.paper },
    { at: [656, 718], fill: C.lantern },
  ],
  ai_chat: [
    { at: [926, 324], fill: C.paper },
    { at: [772, 612], fill: C.paper },
    { at: [638, 676], fill: C.limestone },
  ],
  knowledge_system: [
    { at: [692, 534], fill: C.paper },
    { at: [672, 556], fill: C.paper },
    { at: [636, 632], fill: C.paper },
    { at: [666, 732], fill: C.wood },
    { at: [888, 782], fill: C.paper },
    { at: [760, 986], fill: C.paper },
    { at: [972, 978], fill: C.paper },
  ],
  excalidraw_board: [
    { at: [888, 552], fill: C.paper },
    { at: [838, 452], fill: C.sand },
    { at: [738, 596], fill: C.lantern },
    { at: [946, 604], fill: C.lake },
    { at: [900, 256], fill: C.lantern },
    { at: [848, 302], fill: C.woodDark },
    { at: [960, 256], fill: C.woodDark },
    { at: [1068, 820], fill: C.woodDark },
    { at: [920, 836], fill: C.wood },
    { at: [716, 880], fill: C.wood },
    { at: [950, 896], fill: C.wood },
    { at: [806, 902], fill: C.sand },
    { at: [882, 984], fill: C.wood },
    { at: [980, 962], fill: C.woodDark },
    { at: [1022, 910], fill: C.woodDark },
    { at: [1014, 1012], fill: C.woodDark },
    { at: [1026, 850], fill: C.woodDark },
    { at: [750, 870], fill: C.woodDark },
    { at: [710, 1016], fill: C.woodDark },
  ],
  searching: [
    { at: [834, 252], fill: C.wood },
    { at: [774, 378], fill: C.seaLine },
  ],
  inbox: [
    { at: [564, 686], fill: C.paper },
    { at: [618, 606], fill: C.sand },
  ],
};

/**
 * A filled quokka: `uri` (a PNG data URI) and `box`, its visible bounds as fractions of the
 * square (what brand images keep text clear of).
 *   pose        a file in src/assets/characters/ without `.svg` (`_logo` is the face mark)
 *   size        the square raster size in pixels
 *   viewBox     an optional crop of the drawing (the face mark is cropped at its shoulders)
 *   openBottom  when the crop cuts the drawing at the bottom edge, the body is open there:
 *               flood the outside from the top and sides only, so the body still fills
 *   ink         the line colour (the drawings use currentColor)
 */
export async function quokka(pose, { size, viewBox, openBottom = false, ink = C.ink }) {
  let svg = (await readFile(join(root, "src/assets/characters", `${pose}.svg`), "utf8")).replaceAll(
    "currentColor",
    ink,
  );
  if (viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  const box = (svg.match(/viewBox="([^"]*)"/)?.[1] ?? `0 0 ${ART} ${ART}`).split(/[\s,]+/).map(Number);
  const side = Math.max(box[2] ?? ART, box[3] ?? ART);
  const work = ART * Math.max(1, Math.ceil(size / ART));
  const { data, info } = await sharp(Buffer.from(svg), { density: (72 * work) / side })
    .resize(work, work, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
  // The held props: each seed's whole region takes its paint.
  const paint = new Map();
  if (!viewBox) {
    const scale = work / ART;
    for (const { at, fill } of POSE_PAINT[pose] ?? []) {
      const index = Math.round(at[1] * scale) * width + Math.round(at[0] * scale);
      if (region[index] < 2)
        throw new Error(`quokka "${pose}": the paint seed at ${at.join(", ")} is not inside a closed region`);
      paint.set(region[index], rgb(fill));
    }
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
    const fill = paint.get(region[index]) ?? (small.has(region[index]) ? HIGHLIGHT : COCOA);
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
    .resize(size, size, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return {
    uri: `data:image/png;base64,${png.toString("base64")}`,
    box: { left: left / width, top: top / height, right: right / width, bottom: bottom / height },
  };
}
