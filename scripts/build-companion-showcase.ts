// Renders the landing page's companion carousel from the same art and
// placement rules the app uses (src/components/character.tsx), so every slide
// is a combination a person can actually pick: a body preset or the plain
// line drawing, an optional accessory in the default or a custom hue, black or
// white line work, and a real pose. Run with Bun:
//
//   bun scripts/build-companion-showcase.ts
//
// Output: site/src/assets/characters/showcase/*.webp + showcase.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import sharp from "sharp";

import {
  type QuokkaAccessory,
  type QuokkaPose,
  type QuokkaStyle,
  DEFAULT_QUOKKA_ACCESSORY_HUE,
  QUOKKA_STYLE_PRESENTATIONS,
  quokkaAccessoryColor,
  quokkaAccessoryPlacement,
  quokkaCustomColor,
  quokkaFill,
} from "../src/brand/quokka";

type LineColor = "black" | "white";

interface Combo {
  slug: string;
  pose: QuokkaPose;
  style: QuokkaStyle;
  accessory: QuokkaAccessory;
  line: LineColor;
  /** Custom body hue when style is "custom". */
  customHue?: number;
  /** Accessory hue; defaults to the app's default amber. */
  accessoryHue?: number;
  label: string;
  alt: string;
}

// Every entry here must be reachable from Settings → Companion. Goggles are
// parked in the app pickers, so they never appear.
const COMBOS: Combo[] = [
  {
    slug: "cocoa-celebrating",
    pose: "celebrating",
    style: "cocoa",
    accessory: "none",
    line: "black",
    label: "Cocoa · Cheerful",
    alt: "A cocoa quokka celebrating with arms raised",
  },
  {
    slug: "fern-glasses-waving",
    pose: "waving",
    style: "green",
    accessory: "glasses",
    line: "black",
    label: "Fern · Glasses · waving",
    alt: "A fern-green quokka wearing glasses and waving",
  },
  {
    slug: "ocean-bucket-hat-content",
    pose: "base",
    style: "ocean",
    accessory: "bucket-hat",
    line: "black",
    label: "Ocean · Bucket hat · Content",
    alt: "An ocean-blue quokka in an amber bucket hat",
  },
  {
    slug: "iris-glasses-thoughtful",
    pose: "thoughtful",
    style: "iris",
    accessory: "glasses",
    line: "black",
    label: "Iris · Glasses · Thoughtful",
    alt: "An iris-purple quokka in glasses, thinking",
  },
  {
    slug: "berry-bucket-hat-peaceful",
    pose: "rest",
    style: "berry",
    accessory: "bucket-hat",
    accessoryHue: 200,
    line: "black",
    label: "Berry · Blue bucket hat · Peaceful",
    alt: "A berry-pink quokka resting in a blue bucket hat",
  },
  {
    slug: "amber-attentive",
    pose: "listening",
    style: "amber",
    accessory: "none",
    line: "black",
    label: "Amber · Attentive",
    alt: "An amber quokka listening attentively",
  },
  {
    slug: "line-content",
    pose: "base",
    style: "line",
    accessory: "none",
    line: "black",
    label: "Line · the original drawing",
    alt: "The original quokka line drawing without a fill",
  },
  {
    slug: "custom-teal-white-line-searching",
    pose: "searching",
    style: "custom",
    customHue: 190,
    accessory: "none",
    line: "white",
    label: "Custom teal · White line · searching",
    alt: "A teal quokka with white line work holding a magnifying glass",
  },
  {
    slug: "cocoa-glasses-walking",
    pose: "walking",
    style: "cocoa",
    accessory: "glasses",
    line: "black",
    label: "Cocoa · Glasses · walking",
    alt: "A cocoa quokka in glasses walking in profile",
  },
  {
    slug: "fern-bucket-hat-inbox",
    pose: "inbox",
    style: "green",
    accessory: "bucket-hat",
    line: "black",
    label: "Fern · Bucket hat · sorting the inbox",
    alt: "A fern-green quokka in a bucket hat holding an inbox tray",
  },
];

const root = join(import.meta.dir, "..");
const artRoot = join(root, "src/assets/characters");
const outputDir = join(root, "site/src/assets/characters/showcase");
const SIZE = 1536;
const LINE_INK: Record<LineColor, string> = { black: "#111214", white: "#ffffff" };
const ACCESSORY_COLOR_INSET = 0.965;

const CANONICAL_FILES: Partial<Record<QuokkaPose, string>> = {
  base: "base",
  notes: "notes",
  chat: "ai_chat",
  inbox: "inbox",
  board: "excalidraw_board",
  knowledge: "knowledge_system",
  local: "stays_local",
  rest: "rest",
  waving: "waving",
  searching: "searching",
  celebrating: "celebrating",
};

const BUCKET_HAT_OCCLUSION_EDGE = {
  front: [
    [116, 58],
    [155, 92],
    [156, 105],
    [200, 124],
    [256, 130],
    [312, 124],
    [356, 105],
    [357, 92],
    [396, 58],
  ],
  "three-quarter": [
    [132, 92],
    [162, 107],
    [207, 128],
    [258, 132],
    [316, 128],
    [364, 112],
    [366, 100],
  ],
  side: [
    [152, 93],
    [186, 94],
    [194, 111],
    [241, 130],
    [292, 132],
    [345, 128],
    [383, 111],
    [381, 99],
  ],
} as const;

async function dataUri(relativePath: string, mime: string): Promise<string> {
  const bytes = await readFile(join(artRoot, relativePath));
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function pct(value: number): string {
  return `${((value / 512) * 100).toFixed(3)}%`;
}

type Placement = ReturnType<typeof quokkaAccessoryPlacement>;

function accessoryTransform(placement: Placement, inset = 1): string {
  return [
    `transform-origin: ${pct(placement.originX)} ${pct(placement.originY)}`,
    `transform: translate(${pct(placement.translateX)}, ${pct(placement.translateY)}) rotate(${placement.rotate}deg) scale(${placement.scaleX * inset}, ${placement.scaleY * inset})`,
    accessoryClip(placement),
  ]
    .filter(Boolean)
    .join("; ");
}

function accessoryClip(placement: Placement): string {
  const { clipXMin, clipXMax, clipBand } = placement;
  if (clipXMax !== undefined && clipBand) {
    const points = [
      "0% 0%",
      `${pct(clipXMax)} 0%`,
      `${pct(clipXMax)} ${pct(clipBand.yMin)}`,
      `${pct(clipBand.toX)} ${pct(clipBand.yMin)}`,
      `${pct(clipBand.toX)} ${pct(clipBand.yMax)}`,
      `${pct(clipXMax)} ${pct(clipBand.yMax)}`,
      `${pct(clipXMax)} 100%`,
      "0% 100%",
    ];
    return `clip-path: polygon(${points.join(", ")})`;
  }
  if (clipXMin !== undefined || clipXMax !== undefined) {
    return `clip-path: inset(0 ${clipXMax !== undefined ? pct(512 - clipXMax) : "0%"} 0 ${clipXMin !== undefined ? pct(clipXMin) : "0%"})`;
  }
  return "";
}

function hatAngle(pose: QuokkaPose): keyof typeof BUCKET_HAT_OCCLUSION_EDGE {
  if (pose === "walking") return "side";
  if (pose === "thoughtful" || pose === "listening") return "three-quarter";
  return "front";
}

function placedPoint([x, y]: readonly [number, number], placement: Placement): readonly [number, number] {
  const radians = (placement.rotate * Math.PI) / 180;
  const sx = (x - placement.originX) * placement.scaleX;
  const sy = (y - placement.originY) * placement.scaleY;
  return [
    placement.originX + placement.translateX + sx * Math.cos(radians) - sy * Math.sin(radians),
    placement.originY + placement.translateY + sx * Math.sin(radians) + sy * Math.cos(radians),
  ];
}

function bucketHatBodyClip(placement: Placement, pose: QuokkaPose): string {
  const edge = BUCKET_HAT_OCCLUSION_EDGE[hatAngle(pose)].map((point) => placedPoint(point, placement));
  const first = edge[0]!;
  const last = edge[edge.length - 1]!;
  const boundary = edge.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ");
  return `clip-path: polygon(0 0, ${pct(first[0])} 0, ${boundary}, ${pct(last[0])} 0, 100% 0, 100% 100%, 0 100%)`;
}

async function accessoryArt(accessory: QuokkaAccessory, pose: QuokkaPose) {
  if (accessory === "glasses") {
    return {
      color: await dataUri("concepts/layers/glasses-accessory.webp", "image/webp"),
      ink: await dataUri("concepts/layers/glasses-accessory-ink.webp", "image/webp"),
      colorOverInk: true,
    };
  }
  if (accessory === "bucket-hat") {
    const variant =
      pose === "walking" ? "-side" : pose === "thoughtful" || pose === "listening" ? "-three-quarter" : "";
    return {
      color: await dataUri(`accessories/bucket-hat${variant}-color.svg`, "image/svg+xml"),
      ink: await dataUri(`accessories/bucket-hat${variant}-ink.svg`, "image/svg+xml"),
      colorOverInk: false,
    };
  }
  return null;
}

async function comboHtml(combo: Combo): Promise<string> {
  const fill = combo.style === "custom" ? quokkaCustomColor(combo.customHue) : quokkaFill(combo.style);
  const ink = LINE_INK[combo.line];
  const accessoryColor = quokkaAccessoryColor(combo.accessoryHue ?? DEFAULT_QUOKKA_ACCESSORY_HUE);
  const placement = quokkaAccessoryPlacement(combo.pose, combo.accessory);
  const hatClip = combo.accessory === "bucket-hat" ? bucketHatBodyClip(placement, combo.pose) : "";
  const canonical = CANONICAL_FILES[combo.pose];
  const layers: string[] = [];

  if (canonical) {
    if (fill) {
      const mask = await dataUri(`masks/${canonical}.webp`, "image/webp");
      layers.push(
        `<span class="layer" style="background:${fill}; mask-image:url('${mask}'); ${hatClip}"></span>`,
      );
    }
    const svg = await readFile(join(artRoot, `${canonical}.svg`), "utf8");
    layers.push(`<span class="line" style="${hatClip}">${svg}</span>`);
  } else {
    const body = await dataUri(`concepts/layers/${combo.pose}-body.webp`, "image/webp");
    const line = await dataUri(`concepts/layers/${combo.pose}-line.webp`, "image/webp");
    const detail = await dataUri(`concepts/layers/${combo.pose}-detail.webp`, "image/webp");
    if (fill)
      layers.push(
        `<span class="layer" style="background:${fill}; mask-image:url('${body}'); ${hatClip}"></span>`,
      );
    layers.push(
      `<span class="layer" style="background:${ink}; mask-image:url('${line}'); ${hatClip}"></span>`,
    );
    layers.push(`<img class="detail" src="${detail}" style="${hatClip}" alt="">`);
  }

  const art = await accessoryArt(combo.accessory, combo.pose);
  if (art && fill) {
    const colorLayer = `<span class="layer" style="background:${accessoryColor}; mask-image:url('${art.color}'); ${accessoryTransform(placement, art.colorOverInk ? 1 : ACCESSORY_COLOR_INSET)}"></span>`;
    const inkLayer = `<span class="layer" style="background:${ink}; mask-image:url('${art.ink}'); ${accessoryTransform(placement)}"></span>`;
    layers.push(art.colorOverInk ? inkLayer + colorLayer : colorLayer + inkLayer);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    .quokka { position: relative; width: ${SIZE}px; height: ${SIZE}px; color: ${ink}; }
    .layer, .line, .detail { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .layer { mask-position: center; mask-repeat: no-repeat; mask-size: contain; -webkit-mask-position: center; -webkit-mask-repeat: no-repeat; -webkit-mask-size: contain; }
    .line svg { width: 100%; height: 100%; display: block; }
    .detail { object-fit: contain; }
  </style></head><body><div class="quokka" id="quokka">${layers.join("")}</div></body></html>`;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  for (const combo of COMBOS) {
    await page.setContent(await comboHtml(combo), { waitUntil: "load" });
    await page.evaluate(() =>
      Promise.all([...document.images].map((img) => (img.complete ? null : img.decode()))),
    );
    const png = await page.locator("#quokka").screenshot({ omitBackground: true, type: "png" });
    await sharp(png)
      .webp({ quality: 92, alphaQuality: 100, effort: 6 })
      .toFile(join(outputDir, `${combo.slug}.webp`));
  }
} finally {
  await browser.close();
}

const manifest = COMBOS.map(({ slug, label, alt, style }) => ({
  slug,
  label,
  alt,
  preset: QUOKKA_STYLE_PRESENTATIONS.find((choice) => choice.style === style)?.label ?? style,
}));
await writeFile(join(outputDir, "showcase.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Rendered ${COMBOS.length} companion combinations at ${SIZE} × ${SIZE}.`);
