// sync-excalidraw-fonts — copy Excalidraw's bundled fonts into public/fonts so
// the canvas resolves them offline (window.EXCALIDRAW_ASSET_PATH = "/" in
// src/main.tsx points at the app origin). Vite copies public/ -> dist/ at build
// and Tauri ships dist/, so fonts land at /fonts inside the app with no CDN.
//
// public/fonts is gitignored (generated), so this MUST run before every build.
// It is wired into the `build` npm script and is safe to re-run. Run manually:
//   bun scripts/sync-excalidraw-fonts.mjs
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(
  ROOT,
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "prod",
  "fonts",
);
const DEST = join(ROOT, "public", "fonts");

if (!existsSync(SRC)) {
  console.error(
    `sync-excalidraw-fonts FAILED — source not found: ${SRC}\n` +
      `Run \`bun install\` first (is @excalidraw/excalidraw installed?).`,
  );
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
console.log("sync-excalidraw-fonts ok — Excalidraw fonts -> public/fonts");
