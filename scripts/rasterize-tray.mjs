// rasterize-tray — renders the frozen kit's r-mark (mono) to the menu-bar tray
// PNGs: 22px logical + 44px @2x. The mark is black-on-alpha; macOS tints it as
// a TEMPLATE icon (icon_as_template in src-tauri). Run: bun scripts/rasterize-tray.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(join(ROOT, "src/brand/logo/r-mark.mono.svg"), "utf8");

for (const [file, height] of [
  ["tray.png", 22],
  ["tray@2x.png", 44],
]) {
  const png = new Resvg(svg, { fitTo: { mode: "height", value: height } }).render().asPng();
  const out = join(ROOT, "src-tauri/icons", file);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${height}px tall)`);
}
