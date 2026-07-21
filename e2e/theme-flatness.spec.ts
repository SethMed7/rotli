import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

const themes = ["Warm Light", "Warm Dark", "Paper", "Charcoal"] as const;

test("all four environments keep titlebar tooltips flat and semantically colored", async ({ page }) => {
  await gotoApp(page);
  const themeButton = page.getByRole("button", { name: /^Theme —/ });

  for (const theme of themes) {
    await expect(themeButton).toHaveAccessibleName(`Theme — ${theme}`);
    await themeButton.hover();

    const tip = themeButton.locator(".tip");
    await expect(tip).toHaveCSS("opacity", "1");
    await expect(tip).toHaveCSS("box-shadow", "none");
    await expect(tip).toHaveCSS("filter", "none");

    const colors = await tip.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.cssText = [
        "position:fixed",
        "visibility:hidden",
        "background:var(--surface-2)",
        "color:var(--text)",
        "border:1px solid var(--border-strong)",
      ].join(";");
      document.body.append(probe);
      const actual = getComputedStyle(node);
      const semantic = getComputedStyle(probe);
      const result = {
        background: [actual.backgroundColor, semantic.backgroundColor],
        text: [actual.color, semantic.color],
        border: [actual.borderTopColor, semantic.borderTopColor],
      };
      probe.remove();
      return result;
    });

    expect(colors.background[0]).toBe(colors.background[1]);
    expect(colors.text[0]).toBe(colors.text[1]);
    expect(colors.border[0]).toBe(colors.border[1]);
    await themeButton.click();
  }
});
