// What's new on Rotli Web (2026-09-28): someone who saw an older release gets
// this release's card once, when it has highlights; either way the version is
// recorded, so the next visit is quiet.

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { readOpfsFile, startWithFolder } from "./support";

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const notes = JSON.parse(readFileSync("src/assets/whats-new.json", "utf8")) as Record<string, unknown[]>;
const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;
// the card shows the newest highlighted release after 1.0.0, up to this build
const shown = Object.keys(notes)
  .filter((key) => (notes[key]?.length ?? 0) > 0 && newer(key, "1.0.0") && !newer(key, version))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);

test("an older seen version opens this release's card once, then records it", async ({ page }) => {
  await startWithFolder(page, {
    "wiki/hello.md": "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\n---\n\n# Hello\n\nA note.\n",
    ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: "01TESTNOTE0000000000000001" }] }),
    ".rotli/web/app-settings.json": JSON.stringify({ lastSeenVersion: "1.0.0" }),
  });
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Hello" })).toBeVisible({
    timeout: 20_000,
  });

  const dialog = page.getByRole("dialog", { name: /What’s new in Rotli/ });
  if (shown) {
    await expect(dialog).toHaveAccessibleName(`What’s new in Rotli ${shown}`);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Got it" }).click();
  }
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse(await readOpfsFile(page, ".rotli/web/app-settings.json")).lastSeenVersion)
    .toBe(version);

  await page.reload();
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Hello" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog).toHaveCount(0);
});
