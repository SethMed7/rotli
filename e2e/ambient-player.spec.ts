// Ambient audio and the sidebar player (2026-09-28; docs/design/ambient-audio.md).
// Turning Ambient audio on in Settings puts the player right above the
// sidebar's footer with the ambient track. What browser tabs play is read
// from WebKit in the Mac app only (this build's tabs are always silent), so
// the tab half is proved by the unit tests and a native check.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Ambient audio: turned on in Settings, the player sits above the footer", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByRole("region", { name: "Now playing" })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name: /Ambient audio/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Dusk", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();

  const player = page.getByRole("region", { name: "Now playing" });
  await expect(player).toContainText("Ambient · Dusk");
  await player.getByRole("button", { name: "Next track" }).click();
  await expect(player).toContainText("Ambient · Lamplight");
  // nothing in a tab: no tab to open, no ambient toggle waiting on the left
  await expect(player.getByRole("button", { name: "Open the tab" })).toHaveCount(0);

  // right above the footer
  const [playerBox, footerBox] = await Promise.all([
    player.boundingBox(),
    page.locator(".sb-foot").boundingBox(),
  ]);
  expect(playerBox && footerBox && playerBox.y + playerBox.height <= footerBox.y + 1).toBe(true);
});

// 2026-09-28, the owner: "choose my ambient song in the media player".
test("the player's title picks the ambient sound: any track, or Claude FM", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: /Ambient audio/ }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();

  const player = page.getByRole("region", { name: "Now playing" });
  await player.getByRole("button", { name: /^Choose the ambient sound/ }).click();
  const menu = page.getByRole("menu");
  // the six tracks, then Claude FM; the one playing is the highlighted row
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText([
    "Linen",
    "Graphite",
    "Tide",
    "Canopy",
    "Dusk",
    "Lamplight",
    "Claude FM",
  ]);
  await expect(menu.getByRole("menuitemcheckbox", { name: "Linen" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemcheckbox", { name: "Canopy" }).click();
  await expect(player).toContainText("Ambient · Canopy");
  // (choosing also starts it — services/ambient.test.ts; this browser can't play AAC)

  await player.getByRole("button", { name: /^Choose the ambient sound/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Claude FM" }).click();
  await expect(player).toContainText("Ambient · Claude FM");
});

// 2026-09-28, the owner: "I hear the music but have no idea where it is coming
// from". The ambient element lives on the window (a reloaded module finds it
// again), and ⌘K → Stop all sound silences everything the player can reach.
test("the ambient element can't be orphaned, and Stop all sound silences it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: /Ambient audio/ }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Now playing" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!(window as { __rotliAmbientAudio?: unknown }).__rotliAmbientAudio))
    .toBe(true);

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Stop all sound");
  await page.locator(".prow", { hasText: "Stop all sound" }).first().click();
  const player = page.getByRole("region", { name: "Now playing" });
  await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as { __rotliAmbientAudio?: HTMLAudioElement }).__rotliAmbientAudio?.paused,
    ),
  ).toBe(true);
});
