// Rotli Web's E2E lane. The desktop-twin lane (playwright.config.ts) drives
// `vite dev` with the in-memory demo corpus; this lane builds the WEB bundle
// (ROTLI_PLATFORM=web, served under /app/ like the site does) and proves what
// only that build can: the browser vault persists across a reload, a first
// visit seeds and opens Welcome, and the platform withholds chat. `vite
// preview` sends no Content-Security-Policy — the site's Docker image is the
// prod twin for headers (site/README.md).

import { defineConfig, devices } from "@playwright/test";

const PORT = 1435;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/web",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "bun run build:web && ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web bunx vite preview --port 1435 --strictPort",
    url: `${baseURL}/app/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
