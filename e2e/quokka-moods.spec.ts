// Quokka moods (2026-09-28): Settings → Appearance offers eight idle moods,
// three of them (Friendly, Inquisitive, Adventurous) from poses already drawn, and
// the studio preview wears the chosen mood with the chosen accessory.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the companion's mood picker offers eight moods and the preview follows the choice", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("switch", { name: /Companion off/ }).click();

  const moods = page.getByRole("radiogroup", { name: "Quokka idle mood and pose" });
  await expect(moods.getByRole("radio")).toHaveCount(8);
  for (const mood of ["Friendly", "Inquisitive", "Adventurous"]) {
    await expect(moods.getByRole("radio", { name: new RegExp(`^${mood}`) })).toBeVisible();
  }

  await page
    .getByRole("radiogroup", { name: "Quokka accessory" })
    .getByRole("radio", { name: /^Bucket hat/ })
    .click();
  const preview = page.locator(".quokka-studio-preview .quokka");

  const adventurous = moods.getByRole("radio", { name: /^Adventurous/ });
  await adventurous.click();
  await expect(adventurous).toHaveAttribute("aria-checked", "true");
  // walking is a layered pose: its detail layer names it, and the hat rides along
  await expect(preview.locator(".quokka-detail-layer")).toHaveAttribute("src", /walking/);
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(1);

  const friendly = moods.getByRole("radio", { name: /^Friendly/ });
  await friendly.click();
  await expect(friendly).toHaveAttribute("aria-checked", "true");
  // waving is a canonical line drawing, hat still on
  await expect(preview.locator(".quokka-line svg")).toHaveCount(1);
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(1);
});
