// check-hex — fails if any raw color literal appears under src/, excluding
// src/brand/ (the frozen kit) and src/styles/themes.css (the app's additional
// theme token sets — a token-DEFINITION file, same role as the kit's colors.css;
// the maintainer 2026-06-12). Those two are the only places hex may live.
//
// Also bans FUNCTIONAL color literals (rgb/rgba/hsl/hsla) across the same walk
// (added 2026-07-18): check-design-system.mjs bans them only inside
// src/styles/*.css, which left `style={{ background: "rgb(…)" }}` in a .tsx —
// or a CSS file outside src/styles/ — ungoverned. src/styles/base.css joins
// the exemptions for THIS pattern only: it is the state/elevation token-
// definition file (--hov/--act/--scrim are rgba) and holds no hex.
// Run: bun run check:hex
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const SKIP = join(SRC, "brand");
// welcome.json is lesson prose that teaches the `[Label:#hex]` control suffix;
// it never styles the app, so its example hex is content, not a raw color.
const SKIP_FILES = new Set([join(SRC, "styles", "themes.css"), join(SRC, "assets", "welcome.json")]);
const SKIP_FUNCTIONAL_FILES = new Set([...SKIP_FILES, join(SRC, "styles", "base.css")]);
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html", ".svg", ".json", ".md"]);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNCTIONAL = /\b(?:rgb|rgba|hsl|hsla)\s*\(/g;

const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === SKIP) continue;
      walk(path);
    } else if (TEXT_EXTS.has(extname(entry.name))) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!SKIP_FILES.has(path)) {
          for (const match of line.matchAll(HEX)) {
            hits.push(`${relative(ROOT, path)}:${i + 1}  ${match[0]}`);
          }
        }
        if (!SKIP_FUNCTIONAL_FILES.has(path)) {
          for (const match of line.matchAll(FUNCTIONAL)) {
            hits.push(`${relative(ROOT, path)}:${i + 1}  ${match[0]}…)`);
          }
        }
      });
    }
  }
}

walk(SRC);

if (hits.length > 0) {
  console.error(
    `check:hex FAILED — raw color literals (hex or rgb/hsl) outside the token-definition layer (${hits.length}):`,
  );
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log("check:hex ok — no raw hex or functional color outside the token-definition layer");
