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

test("all four environments use one flat semantic scrim for full-screen backdrops", async ({ page }) => {
  await gotoApp(page);
  const themeButton = page.getByRole("button", { name: /^Theme —/ });

  for (const theme of themes) {
    await expect(themeButton).toHaveAccessibleName(`Theme — ${theme}`);

    const audit = await page.evaluate(() => {
      const semanticProbe = document.createElement("div");
      semanticProbe.style.cssText = "position:fixed;visibility:hidden;background:var(--scrim)";
      document.body.append(semanticProbe);
      const expectedBackground = getComputedStyle(semanticProbe).backgroundColor;
      semanticProbe.remove();

      const backdrops = [
        { name: "command palette", className: "pal-scrim" },
        { name: "WhichKey", className: "whichkey", pseudo: "::before" },
        { name: "rename", className: "rename-overlay" },
        { name: "render expansion", className: "rotli-render-overlay" },
        { name: "Mermaid workspace", className: "rotli-mermaid-workspace" },
      ];

      const results = backdrops.map(({ name, className, pseudo }) => {
        const probe = document.createElement("div");
        probe.className = className;
        document.body.append(probe);
        const style = getComputedStyle(probe, pseudo);
        const result = {
          name,
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
          filter: style.filter,
          backdropFilter: style.getPropertyValue("backdrop-filter"),
          webkitBackdropFilter: style.getPropertyValue("-webkit-backdrop-filter"),
        };
        probe.remove();
        return result;
      });

      return { expectedBackground, results };
    });

    for (const result of audit.results) {
      expect(result.background, `${theme}: ${result.name} background`).toBe(audit.expectedBackground);
      expect(result.backgroundImage, `${theme}: ${result.name} background image`).toBe("none");
      expect(result.boxShadow, `${theme}: ${result.name} shadow`).toBe("none");
      expect(result.filter, `${theme}: ${result.name} filter`).toBe("none");
      expect(["", "none"], `${theme}: ${result.name} backdrop filter`).toContain(result.backdropFilter);
      expect(["", "none"], `${theme}: ${result.name} WebKit backdrop filter`).toContain(
        result.webkitBackdropFilter,
      );
    }

    await themeButton.click();
  }
});
