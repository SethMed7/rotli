// Custom themes on Rotli Web: a theme file imported through the real control
// applies for the session, Appearance says it lasts until reload, and a
// reload starts cleanly on the theme's base family with nothing left to
// flash (theme files live beside the Mac app's settings, not in the vault).
import { expect, test } from "@playwright/test";

import { FOREST_PAPER, themeText } from "../../src/brand/themeEngine/themes.fixtures";
import { readOpfsFile, startWithVault } from "./support";

test("an imported theme lasts the session on Rotli Web, and a reload starts on its base family", async ({
  page,
}) => {
  await startWithVault(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByText("In the browser, imported themes last until you reload.")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import theme…", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "forest-paper.rotli-theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(themeText(FOREST_PAPER)),
  });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "custom-light");
  await expect(html).toHaveAttribute("data-theme-id", "forest-paper");
  // the base family is saved; the theme and its first-paint cache are not
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("rotli.lastDataTheme")))
    .toBe("grove-light");
  expect(await page.evaluate(() => window.localStorage.getItem("rotli.customThemeBoot"))).toBeNull();
  // the settings file is rewritten as a whole; a read mid-write is "not yet"
  const settings = async (): Promise<object | null> => {
    try {
      return JSON.parse(await readOpfsFile(page, ".rotli/web/app-settings.json")) as object;
    } catch {
      return null;
    }
  };
  await expect.poll(settings).toMatchObject({ themeFamily: "grove", customTheme: null });

  await page.reload();
  await expect(page.locator(".tabstrip").first()).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "grove-light");
  await expect(html).not.toHaveAttribute("data-theme-id", /.*/);
});
