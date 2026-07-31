// sync-excalidraw-fonts — copy Excalidraw's bundled fonts into public/fonts so
// the canvas resolves them offline (window.EXCALIDRAW_ASSET_PATH = "/" in
// src/main.tsx points at the app origin). Vite copies public/ -> dist/ at build
// and Tauri ships dist/, so fonts land at /fonts inside the app with no CDN.
//
// public/fonts is gitignored (generated), so this MUST run before every build.
// It is wired into the `build` npm script and is safe to re-run. Run manually:
//   bun scripts/sync-excalidraw-fonts.mjs
//
// KEEP is an explicit allowlist (size diet, 2026-07-31): Xiaolai — a Chinese
// handwriting family whose CJK woff2 subsets are 12.8 MB of the 14 MB font
// payload, ~32% of the whole installed app — is deliberately NOT shipped.
// CJK text on boards falls back to a system font. woff2 is already compressed,
// so every font byte here lands in the Tauri binary byte-for-byte; an unknown
// new family fails the build so a heavy addition is always a human decision.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = new Set([
  "Assistant",
  "Cascadia",
  "ComicShanns",
  "Excalifont",
  "Liberation",
  "Lilita",
  "Nunito",
  "Virgil",
]);
const DROP = new Set(["Xiaolai"]);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const DEST = join(ROOT, "public", "fonts");

if (!existsSync(SRC)) {
  console.error(
    `sync-excalidraw-fonts FAILED — source not found: ${SRC}\n` +
      `Run \`bun install\` first (is @excalidraw/excalidraw installed?).`,
  );
  process.exit(1);
}

const families = readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory());
const unknown = families.filter((name) => !KEEP.has(name) && !DROP.has(name));
if (unknown.length) {
  console.error(
    `sync-excalidraw-fonts FAILED — Excalidraw ships font families this script does not know: ` +
      `${unknown.join(", ")}.\n` +
      `Every family lands in the app binary byte-for-byte; add each to KEEP (ship it) or DROP ` +
      `(exclude it) in scripts/sync-excalidraw-fonts.mjs deliberately.`,
  );
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
const kept = families.filter((name) => KEEP.has(name));
for (const family of kept) cpSync(join(SRC, family), join(DEST, family), { recursive: true });
const dropped = families.filter((name) => DROP.has(name));
console.log(
  `sync-excalidraw-fonts ok — ${kept.length} families -> public/fonts` +
    (dropped.length ? ` (excluded: ${dropped.join(", ")})` : ""),
);
