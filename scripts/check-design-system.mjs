import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BREVE_PDF_PRESETS,
  contrastRatio,
  validateBrevePdfPalette,
} from "../src/brand/brevePdfThemes.ts";
import { flatCssViolations } from "./design-system-policy.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const colors = read("src/brand/tokens/colors.css");
const themes = read("src/styles/themes.css");
const base = read("src/styles/base.css");
const themeState = read("src/state/theme.ts");
const uiState = read("src/state/ui.ts");
const breveStyles = read("src/styles/breve.css");
const brandBoard = read("src/brand/board.html");
const brandDefinition = JSON.parse(read("src/brand/brand.json"));
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
  "accent", "accent-text", "on-accent", "success", "syntax-blue", "syntax-accent",
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
  const syntaxBlue = /--syntax-blue\s*:\s*(#[0-9a-f]{6})/i.exec(body)?.[1];
  const ground = /--ground\s*:\s*(#[0-9a-f]{6})/i.exec(body)?.[1];
  if (syntaxBlue && ground && contrastRatio(syntaxBlue, ground) < 4.5) {
    violations.push(`${theme}: --syntax-blue needs 4.5:1 contrast against --ground`);
  }
}

const rootBody = allBlocks.filter((block) => block.selectors.includes(":root")).map((block) => block.body).join("\n");
for (const token of [
  "hov",
  "act",
  "scrim",
  "border-strong",
  "danger",
  "quote-bar",
  "check-ink",
  "seg-accent",
  "icon-clay",
  "icon-olive",
]) {
  if (!new RegExp(`--${token}\\s*:`).test(rootBody)) violations.push(`base state grammar: missing --${token}`);
}

// Product CSS consumes semantic colors/elevation. Literal functional colors
// belong only in the token-definition files so every new surface works in all
// four themes. Static document preview CSS is TypeScript and intentionally has
// its own paper palette; this check covers the app chrome under src/styles/.
for (const file of readdirSync(join(root, "src/styles")).filter((name) => name.endsWith(".css"))) {
  const path = `src/styles/${file}`;
  const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
  violations.push(...flatCssViolations(source, path));
  if (file !== "base.css" && file !== "themes.css" && /\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(source)) {
    violations.push(`src/styles/${file}: functional color bypasses semantic theme tokens`);
  }
}
violations.push(...flatCssViolations(brandBoard, "src/brand/board.html"));
if (/\b(?:glow|halo|shadow)s?\b/i.test(brandDefinition.shape.language.join(" "))) {
  violations.push("src/brand/brand.json: shape language contradicts Rotli's flat material policy");
}

// Class naming is one dialect: kebab-case (BEM `--modifier` allowed — e.g.
// .appicon-tile--paper), component/feature-prefixed (rotli-*, cm-*, chat-*,
// mem-*, …). Measured 2026-07-18 at ~950 class selectors across all 13 files
// with zero camelCase/snake_case — this locks that in without adding a
// stylelint toolchain. Strings, url() bodies, and comments are stripped first
// so a data-URI or content string never trips it.
const CLASS_KEBAB = /^[a-z0-9]+(-{1,2}[a-z0-9]+)*$/;
for (const file of readdirSync(join(root, "src/styles")).filter((name) => name.endsWith(".css"))) {
  const source = read(`src/styles/${file}`)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/url\([^)]*\)/g, "url()");
  for (const match of source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    if (!CLASS_KEBAB.test(match[1])) {
      violations.push(`src/styles/${file}: class selector .${match[1]} must be kebab-case`);
    }
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
// The idle pause is load-bearing, not decorative: WKWebView does not promise to
// suspend a hidden webview and WebKitGTK is worse, so a deleted rule would let
// every infinite animation composite while the window is tucked away.
// lib/idleMotion.ts stamps the attribute; this asserts the rule that consumes it.
if (!/:root\[data-idle="hidden"\][^{]*\{[^}]*animation-play-state:\s*paused/s.test(base)) {
  violations.push("base.css: missing the idle animation pause (:root[data-idle=\"hidden\"])");
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
