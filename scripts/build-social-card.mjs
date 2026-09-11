// Render the editable, code-native SVG with the same bundled fonts as the site.
import { readFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

const source = new URL("../site/public/social-card.svg", import.meta.url);
let svg = await readFile(source, "utf8");
for (const font of ["GeneralSans-Regular.woff2", "GeneralSans-Semibold.woff2"]) {
  const bytes = await readFile(new URL(`../site/public/fonts/${font}`, import.meta.url));
  svg = svg.replace(`fonts/${font}`, `data:font/woff2;base64,${bytes.toString("base64")}`);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("svg")
    .screenshot({ path: new URL("../site/public/social-card.png", import.meta.url).pathname });
} finally {
  await browser.close();
}
console.log("Rendered site/public/social-card.png (1200×630).");
