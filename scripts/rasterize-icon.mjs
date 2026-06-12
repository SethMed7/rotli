// rasterize-icon — renders the frozen kit's app tile (src/brand/tiles/app-icon-512.svg)
// to a 1024px PNG with alpha (the rounded tile keeps transparent corners), the input
// `bun tauri icon` needs to generate src-tauri/icons. Run: bun scripts/rasterize-icon.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(join(ROOT, "src/brand/tiles/app-icon-512.svg"), "utf8");

const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();

const outDir = join(ROOT, "scripts/.icon");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "app-icon-1024.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
