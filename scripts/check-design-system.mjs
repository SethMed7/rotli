import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BREVE_PDF_PRESETS, validateBrevePdfPalette } from "../src/brand/brevePdfThemes.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const colors = read("src/brand/tokens/colors.css");
const themes = read("src/styles/themes.css");
const base = read("src/styles/base.css");
const themeState = read("src/state/theme.ts");
const uiState = read("src/state/ui.ts");
const breveStyles = read("src/styles/breve.css");
const violations = [];

function blocks(css) {
  const withoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import\s+[^;]+;/g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((selector) => selector.trim()),
    body: match[2],
  }));
}

const allBlocks = blocks(`${colors}\n${base}\n${themes}`);
const requiredTokens = [
  "ground", "surface", "surface-2", "tint", "text", "text-muted", "border",
  "accent", "accent-text", "on-accent", "success",
];
const themeSelectors = {
  light: ":root",
  dark: ':root[data-theme="dark"]',
  paper: ':root[data-theme="paper"]',
  charcoal: ':root[data-theme="charcoal"]',
};

for (const [theme, selector] of Object.entries(themeSelectors)) {
  const body = allBlocks.filter((block) => block.selectors.includes(selector)).map((block) => block.body).join("\n");
  for (const token of requiredTokens) {
    if (!new RegExp(`--${token}\\s*:`).test(body)) violations.push(`${theme}: missing --${token}`);
  }
}

const rootBody = allBlocks.filter((block) => block.selectors.includes(":root")).map((block) => block.body).join("\n");
for (const token of [
  "hov", "act", "scrim", "shadow-control", "shadow-raised", "shadow-popover",
  "shadow-dialog", "shadow-accent",
]) {
  if (!new RegExp(`--${token}\\s*:`).test(rootBody)) violations.push(`base state grammar: missing --${token}`);
}

// Product CSS consumes semantic colors/elevation. Literal functional colors
// belong only in the token-definition files so every new surface works in all
// four themes. Static document preview CSS is TypeScript and intentionally has
// its own paper palette; this check covers the app chrome under src/styles/.
for (const file of readdirSync(join(root, "src/styles")).filter((name) => name.endsWith(".css"))) {
  if (file === "base.css" || file === "themes.css") continue;
  const source = read(`src/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(source)) {
    violations.push(`src/styles/${file}: functional color bypasses semantic theme tokens`);
  }
}

const expectedDataThemes = Object.keys(themeSelectors);
for (const theme of expectedDataThemes) {
  if (!themeState.includes(`"${theme}"`)) violations.push(`theme.ts: DataTheme omits ${theme}`);
}
for (const label of ["Warm Light", "Warm Dark", "Paper", "Charcoal"]) {
  if (!uiState.includes(`label: "${label}"`)) violations.push(`ui.ts: solid theme picker omits ${label}`);
}

const importOrder = [
  '@import "../brand/tokens/colors.css";',
  '@import "../brand/tokens/type.css";',
  '@import "./themes.css";',
];
let cursor = -1;
for (const statement of importOrder) {
  const next = base.indexOf(statement);
  if (next < 0 || next <= cursor) violations.push(`base.css: token imports must keep colors → type → themes order (${statement})`);
  cursor = next;
}

if (!/:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/s.test(base)) {
  violations.push("base.css: missing the shared visible keyboard focus ring");
}
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(base)) {
  violations.push("base.css: missing reduced-motion fallback");
}
if (/@media\s*\(prefers-color-scheme:/.test(`${colors}\n${themes}`)) {
  violations.push("theme tokens must not follow the OS implicitly; state/theme.ts owns system mode");
}

for (const match of breveStyles.matchAll(/font-size:\s*([\d.]+)px/g)) {
  if (Number(match[1]) < 10) {
    violations.push(`breve.css: ${match[1]}px text is below the compact desktop floor`);
  }
}

for (const [name, palette] of Object.entries(BREVE_PDF_PRESETS)) {
  const error = validateBrevePdfPalette(palette);
  if (error) violations.push(`Breve PDF preset ${name}: ${error}`);
}

if (violations.length) {
  console.error(`design-system regression failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:design-system ok — ${expectedDataThemes.length} app themes + ${Object.keys(BREVE_PDF_PRESETS).length} PDF palettes`);
