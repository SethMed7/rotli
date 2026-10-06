// The website's E2E lane (rotli.co, site/): the built site under `astro preview`, which
// proves what only a browser can about its interactive pieces: the privacy passage, the
// footer's quokka scene, the 404 game, and the resource reading meter. `astro preview` sends
// no Content-Security-Policy; the build's own inline-style guard and the Docker prod twin
// (site/README.md) cover headers. The unit rules behind these pages are
// scripts/site-interactions.test.ts.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.ROTLI_SITE_E2E_PORT ?? 4392);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/site",
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
    command: `cd site && CI=true SITE_MODE=full bun run build && bunx astro preview --host 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
