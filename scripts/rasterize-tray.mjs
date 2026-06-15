// rasterize-tray — renders the frozen kit's r-mark (mono) to the menu-bar tray
// PNGs: 22px logical + 44px @2x. The mark is black-on-alpha; macOS tints it as
// a TEMPLATE icon (icon_as_template in src-tauri).
//
// THE PADDING (Seth, 2026-06-15): "make it fit in with the others." macOS menu-
// bar glyphs don't fill the bar — they sit at ~70% of its height with air around
// them. The raw mark fit edge-to-edge looked oversized and heavy next to its
// neighbors, so we pad the glyph into a larger transparent canvas (GLYPH_FILL of
// the height) and let the same height-fit shrink the mark, not blow it up.
// Run: bun scripts/rasterize-tray.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

/** The mark occupies this fraction of the canvas height — the rest is air, so
 * the menu-bar icon lands at the same optical size as the system glyphs. */
const GLYPH_FILL = 0.73;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "src/brand/logo/r-mark.mono.svg"), "utf8");

// The mark's own box (its viewBox) and inner markup (the <path>), reused as-is
// at native scale — only translated, never distorted.
const [, vbW, vbH] = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const inner = src.replace(/[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// Symmetric padding sized off the dominant (vertical) dimension, applied on all
// sides so a narrow mark keeps a little horizontal air too.
const pad = Math.round((vbH / GLYPH_FILL - vbH) / 2);
const canvasW = vbW + pad * 2;
const canvasH = vbH + pad * 2;
const padded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasW} ${canvasH}"><g transform="translate(${pad},${pad})">${inner}</g></svg>`;

for (const [file, height] of [
  ["tray.png", 22],
  ["tray@2x.png", 44],
]) {
  const png = new Resvg(padded, { fitTo: { mode: "height", value: height } }).render().asPng();
  const out = join(ROOT, "src-tauri/icons", file);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${height}px tall canvas, mark ~${Math.round(height * GLYPH_FILL)}px)`);
}
