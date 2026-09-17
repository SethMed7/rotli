// Render the editable, code-native SVG with the same bundled fonts as the site.
// Every asset the card needs is inlined (fonts as data URIs, the quokka as a
// nested <svg>) and every network route is aborted, so a missing inline shows
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

const out = (name) => new URL(`../site/public/${name}`, import.meta.url).pathname;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route) => route.abort());
  // The GitHub export centres the 1200×630 card on a 1280×640 ground of the same paper.
  await page.setContent(
    `<style>body{margin:0;background:#f8f2e9;width:1280px;height:640px;display:grid;place-items:center}</style>${svg}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("svg")
    .first()
    .screenshot({ path: out("social-card.png") });
  await page.screenshot({
    path: out("social-card-github.png"),
    clip: { x: 0, y: 0, width: 1280, height: 640 },
  });
} finally {
  await browser.close();
}
console.log("Rendered site/public/social-card.png (1200×630) and social-card-github.png (1280×640).");
