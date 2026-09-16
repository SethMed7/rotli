// The regression layer's browser-mode E2E lane (docs/architecture/code-audit.md,
// "Regression-layer handoff"). Every spec drives the SAME browser twin the rest
// of the app targets: isTauri() is false under `vite dev`, so the UI renders
// against the seeded in-memory demo corpus (src/services/notes.ts) with no Rust
// shell, no onboarding gate, and no real filesystem/network/Keychain access.
// Chromium only — this proves pointer-drag/DOM behavior, not native titlebar,
// menu-bar, or OS-level drag; that stays a human/native check (AGENTS.md).

import { defineConfig, devices } from "@playwright/test";

const PORT = 1420;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // e2e/web/ is Rotli Web's lane (playwright.web.config.ts): it needs the web
  // bundle under /app/, which `vite dev` does not serve.
  testIgnore: /e2e\/web\//,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // fullyParallel was configured but never granted: CI ran 103 specs on ONE
  // worker (~6 min). Four workers on the hosted runner; local keeps the default.
  ...(process.env.CI ? { workers: 4 } : {}),
  // the github reporter annotates a retried-then-passed spec in the run
  // summary, so a flake is visible without opening the HTML artifact
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // `vite` (via `bun run dev`) — the same browser twin every other regression
  // layer targets. `strictPort` in vite.config.ts fails fast if 1420 is busy
  // rather than silently drifting to another port Playwright wouldn't find.
  webServer: {
    command: "bun run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
