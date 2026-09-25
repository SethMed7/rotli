// Render the editable, code-native SVG with the same bundled fonts as the site.
// Every asset the card needs is inlined (fonts and raster art as data URIs,
// the quokka's lines as a nested <svg>) and every network route is aborted, so a missing inline shows
// up as a visibly blank region in the PNG rather than a silent fallback.
//
// Two renders:
//   site/public/social-card.png         1200×630  Open Graph / Twitter / iMessage / Slack
//   site/public/social-card-github.png  1280×640  GitHub → Settings → Social preview (2:1)
import { readFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

const source = new URL("../site/public/social-card.svg", import.meta.url);
let svg = await readFile(source, "utf8");
const fonts = [
  ["GeneralSans-Regular.woff2", "font/woff2"],
  ["GeneralSans-Semibold.woff2", "font/woff2"],
  ["Baloo2-600.ttf", "font/ttf"],
];
for (const [font, mime] of fonts) {
  const bytes = await readFile(new URL(`../site/public/fonts/${font}`, import.meta.url));
  svg = svg.replace(`fonts/${font}`, `data:${mime};base64,${bytes.toString("base64")}`);
}
if (/url\("fonts\//.test(svg)) throw new Error("social-card.svg references a font that was not inlined");
// Raster art (the app capture, the quokka's silhouette) is referenced as
// href="asset:<path from the repository root>" and inlined the same way.
const mimes = { png: "image/png", webp: "image/webp", jpg: "image/jpeg" };
for (const [, path] of [...svg.matchAll(/href="asset:([^"]+)"/g)]) {
  const mime = mimes[path.split(".").pop()];
  if (!mime) throw new Error(`social-card.svg references an asset of unknown type: ${path}`);
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  svg = svg.replaceAll(`asset:${path}`, `data:${mime};base64,${bytes.toString("base64")}`);
}
if (/href="asset:/.test(svg)) throw new Error("social-card.svg references an asset that was not inlined");

const out = (name) => new URL(`../site/public/${name}`, import.meta.url).pathname;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("svg")
    .first()
    .screenshot({ path: out("social-card.png") });
  // The GitHub export (2:1) scales the card to cover 1280 wide and trims 16 px from the top
  // and bottom, so the scenery that runs to the card's edges (the bay, the beach) still does.
  await page.setContent(
    `<style>body{margin:0;overflow:hidden;width:1280px;height:640px;position:relative}` +
      `body>svg{position:absolute;left:0;top:-16px;width:1280px;height:672px}</style>${svg}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: out("social-card-github.png"),
    clip: { x: 0, y: 0, width: 1280, height: 640 },
  });
} finally {
  await browser.close();
}
console.log("Rendered site/public/social-card.png (1200×630) and social-card-github.png (1280×640).");
