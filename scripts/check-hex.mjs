// check-hex — fails if any raw hex color literal appears under src/, excluding
// src/brand/ (the frozen kit is the only place hex may live). Run: bun run check:hex
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const SKIP = join(SRC, "brand");
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html", ".svg", ".json", ".md"]);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

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
        for (const match of line.matchAll(HEX)) {
          hits.push(`${relative(ROOT, path)}:${i + 1}  ${match[0]}`);
        }
      });
    }
  }
}

walk(SRC);

if (hits.length > 0) {
  console.error(`check:hex FAILED — raw hex color literals outside src/brand/ (${hits.length}):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log("check:hex ok — no raw hex outside src/brand/");
