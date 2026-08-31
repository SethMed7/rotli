import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

const settingsPanes = [
  "General",
  "Keybindings",
  "Appearance",
  "Browser",
  "Librarian",
  "Security",
  "AI Models",
  "Location",
  "Connections",
] as const;

test("every Settings pane keeps its small Rotli accent crisp and theme-safe", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("switch", { name: /Companion off/ }).click();
  await page.getByRole("radio", { name: /Glasses/ }).click();

  for (const pane of settingsPanes) {
    await page.getByRole("button", { name: pane, exact: true }).click();
    const accent = page.locator(".set-panehead .set-paneaccent");

    await expect(accent).toBeVisible();
    await expect(accent.locator(".quokka-line")).toHaveCount(1);
    await expect(accent.locator(".quokka-body-layer, .quokka-accessory-layer")).toHaveCount(0);
    await expect(accent).toHaveCSS("opacity", "1");

    const ink = await accent.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:fixed;visibility:hidden;color:var(--text-muted)";
      document.body.append(probe);
      const result = {
        actual: getComputedStyle(node).color,
        expected: getComputedStyle(probe).color,
        inlineOverride: (node as HTMLElement).style.getPropertyValue("--quokka-ink"),
      };
      probe.remove();
      return result;
    });

    expect(ink.actual).toBe(ink.expected);
    expect(ink.inlineOverride).toBe("");
  }

  await page.getByRole("button", { name: "General", exact: true }).click();
  const accent = page.locator(".set-panehead .set-paneaccent");
  const themeButton = page.getByRole("button", { name: /^Theme —/ });

  // The titlebar cycles all twelve family/environment pairs. The quiet accent
  // must keep using the semantic muted ink in every one, not a user-selected
  // black/white line that can disappear against the current surface.
  for (let index = 0; index < 12; index += 1) {
    const colors = await accent.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:fixed;visibility:hidden;color:var(--text-muted)";
      document.body.append(probe);
      const result = [getComputedStyle(node).color, getComputedStyle(probe).color];
      probe.remove();
      return result;
    });
    expect(colors[0]).toBe(colors[1]);
    await themeButton.click();
  }
});
