import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  bundleBudgetViolations,
  MAX_LAZY_CHUNK_KIB,
  shouldIgnoreBuildWarning,
} from "./scripts/build-policy.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// injected sync so the onboardingVersion gate has the build version at first paint
const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Excalidraw reads `process.env.IS_PREACT` at runtime; Vite strips `process`,
  // so define the symbol (we use React, not Preact) to avoid a runtime
  // "ReferenceError: process is not defined" the moment <Excalidraw/> mounts.
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
    __APP_VERSION__: JSON.stringify(appVersion),
  },

  build: {
    // Optional editors (Univer, Excalidraw, Mermaid, exceljs) are intentionally
    // lazy and much larger than the startup graph. Replace Vite's one-size-fits-
    // all warning with hard, tested startup/lazy budgets.
    chunkSizeWarningLimit: MAX_LAZY_CHUNK_KIB,
    rollupOptions: {
      onwarn(warning, warn) {
        if (!shouldIgnoreBuildWarning(warning)) warn(warning);
      },
      plugins: [
        {
          name: "rotli-bundle-budget",
          generateBundle(_options, bundle) {
            const violations = bundleBudgetViolations(bundle);
            if (violations.length) {
              this.error(`bundle budget regression:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
            }
          },
        },
      ],
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
