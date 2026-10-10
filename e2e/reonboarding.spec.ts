// 1.8.0 re-onboarding (the owner, 2026-10-09): everyone set up before 1.8.0
// goes through setup once more, then sees what's new. Someone returning is
// not a first run: Skip setup keeps what they had, and finishing ends at the
// release's What's new instead of the thank-you card. The launch gate itself
// is state/onboarding.ts reonboardingFor (unit-tested; the Mac app only);
// this drives the development `?onboarding` route as someone set up on 1.7.1.

import { expect, type Page, test } from "@playwright/test";

/** The development setup review, as someone who finished setup on 1.7.1. */
async function returningSetup(page: Page): Promise<void> {
  await page.goto("/?onboarding");
  await page.getByPlaceholder("Your first name").waitFor();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((entry) => new URL(entry).pathname === "/src/state/ui.ts");
    if (!url) throw new Error("ui store is not mounted");
    const { useUiStore } = await import(/* @vite-ignore */ url);
    useUiStore.setState({ onboardingVersion: "1.7.1" });
  });
}

test("someone set up before 1.8.0 finishes setup at what's new, not the thank-you card", async ({ page }) => {
  await returningSetup(page);
  await page.getByPlaceholder("Your first name").fill("Ada");
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await page.getByRole("button", { name: "Choose a folder" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page.getByRole("dialog", { name: "What’s new in Rotli 1.8.0" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Thank you for trying Rotli" })).toHaveCount(0);
});

test("Skip setup keeps a returning person's own look", async ({ page }) => {
  await returningSetup(page);
  // their look, chosen on setup's own theme control (a first run's Skip setup
  // would put Rotli Light back)
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: /Grove/ }).click();
  await page.getByRole("button", { name: "Skip setup" }).click();
  // the browser review has no vault yet: the one prompt for a folder
  await page.getByRole("button", { name: "Choose a folder" }).click();

  await expect(page.getByRole("dialog", { name: "What’s new in Rotli 1.8.0" })).toBeVisible();
  const family = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((entry) => new URL(entry).pathname === "/src/state/ui.ts");
    const { useUiStore } = await import(/* @vite-ignore */ url!);
    return useUiStore.getState().themeFamily as string;
  });
  expect(family).toBe("grove");
});
