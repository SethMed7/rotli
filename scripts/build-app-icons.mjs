// build-app-icons — the macOS app/Dock icon family, drawn from the canonical
// quokka (src/assets/characters/_logo.svg). One source for three outputs:
//   src-tauri/icons/icon.icns          the bundle icon (the "default" variant)
//   src-tauri/icons/variants/<id>.png  runtime Dock overrides (Settings → App icon)
//   src/assets/appIcons/<id>.png       the Settings picker thumbnails
// Geometry follows Apple's macOS grid: an 824 tile centered on a transparent
// 1024 canvas, so the Dock draws Rotli at the same size as every other app.
// Windows/Linux icons (icon.ico, the 32/128 PNGs) have no margin and stay put.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const logo = readFileSync(join(root, "src/assets/characters/_logo.svg"), "utf8");

// id → tile + quokka ink. "warm" is retired from the picker but kept so a
// stored preference still resolves. A variant may instead name a `field`
// (a gradient) and a `shape`: "tesven" is Rotli's white line quokka on Tesven's
// One Blue field, in Tesven's n=5 superellipse (from Tesven's brand kit: its
// app icon and the legacy macOS icon).
const VARIANTS = {
  default: { tile: "#f8f2e9", ink: "#1b1b1b" },
  warm: { tile: "#f8f2e9", ink: "#3a3028" },
  paper: { tile: "#ffffff", ink: "#161616" },
  charcoal: { tile: "#1f1e1c", ink: "#e9e7e2" },
  clay: { tile: "#c97e62", ink: "#f8f2e9" },
  black: { tile: "#000000", ink: "#ffffff" },
  tesven: { field: "oneBlue", shape: "squircle", ink: "#ffffff" },
};

// Tesven's One Blue field, the same gradient as Tesven's own app icon: deep
// #0F4C81 to #2B86D1, with its light glow at the top right. Flat, no grain or
// glass (the system adds its own effects; Rotli's brand bans decorative filters).
const FIELDS = {
  oneBlue:
    '<linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f4c81"/>' +
    '<stop offset=".6" stop-color="#1767a8"/><stop offset="1" stop-color="#2b86d1"/></linearGradient>' +
    '<radialGradient id="g" cx=".82" cy=".16" r=".55"><stop offset="0" stop-color="#3c9be0" stop-opacity=".9"/>' +
    '<stop offset="1" stop-color="#3c9be0" stop-opacity="0"/></radialGradient>',
};

const CANVAS = 1024;
const TILE = 824;
const INSET = (CANVAS - TILE) / 2;
const RADIUS = 185;
const INK_WIDTH = Math.round(TILE * 0.5);
const INK_LIFT = Math.round(TILE * 0.011); // optical centering: the cut-off body reads low

// Tesven's squircle: an n=5 superellipse filling the same 824 body.
function squircle(n = 5, steps = 256) {
  const half = TILE / 2;
  const at = (v) => Math.sign(v) * Math.abs(v) ** (2 / n) * half + CANVAS / 2;
  const points = Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    return `${at(Math.cos(t)).toFixed(1)} ${at(Math.sin(t)).toFixed(1)}`;
  });
  return `M${points.join(" L")} Z`;
}

function tileSvg({ tile, field, shape }) {
  const body =
    shape === "squircle"
      ? `<path d="${squircle()}"`
      : `<rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${RADIUS}"`;
  const fills = field
    ? [`${body} fill="url(#f)"/>`, `${body} fill="url(#g)"/>`]
    : [`${body} fill="${tile}"/>`];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">` +
    (field ? `<defs>${FIELDS[field]}</defs>` : "") +
    fills.join("") +
    "</svg>"
  );
}

async function master({ ink, ...look }) {
  const quokka = await sharp(Buffer.from(logo.replaceAll("currentColor", ink)), { density: 300 })
    .trim()
    .resize({ width: INK_WIDTH })
    .png()
    .toBuffer({ resolveWithObject: true });
  const background = Buffer.from(tileSvg(look));
  return sharp(background)
    .composite([
      {
        input: quokka.data,
        left: Math.round((CANVAS - quokka.info.width) / 2),
        top: Math.round((CANVAS - quokka.info.height) / 2) - INK_LIFT,
      },
    ])
    .png()
    .toBuffer();
}

const variantsDir = join(root, "src-tauri/icons/variants");
const previewsDir = join(root, "src/assets/appIcons");
mkdirSync(previewsDir, { recursive: true });

for (const [id, colors] of Object.entries(VARIANTS)) {
  const image = await master(colors);
  await sharp(image)
    .resize(512)
    .png({ compressionLevel: 9 })
    .toFile(join(variantsDir, `${id}.png`));
  if (id !== "warm") {
    await sharp(image)
      .extract({ left: INSET, top: INSET, width: TILE, height: TILE })
      .resize(112)
      .png({ compressionLevel: 9 })
      .toFile(join(previewsDir, `${id}.png`));
  }
  if (id === "default") {
    const iconset = join(mkdtempSync(join(tmpdir(), "rotli-icon-")), "icon.iconset");
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await sharp(image)
        .resize(size)
        .png()
        .toFile(join(iconset, `icon_${size}x${size}.png`));
      await sharp(image)
        .resize(size * 2)
        .png()
        .toFile(join(iconset, `icon_${size}x${size}@2x.png`));
    }
    execFileSync("iconutil", ["-c", "icns", "-o", join(root, "src-tauri/icons/icon.icns"), iconset]);
    rmSync(join(iconset, ".."), { recursive: true, force: true });
  }
}

console.log("Built the macOS app icon family.");
