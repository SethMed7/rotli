// A host's identity in a real browser (docs/architecture/host-seams.md, "The
// words" and "The look"): its name where Rotli's copy means the running app,
// its starting theme family, and no quokka anywhere. The host is synthetic
// (host-identity.fixture.ts). Standalone Rotli is the rest of the suite.

import { expect, type Page, test } from "@playwright/test";

import { failOnPageErrors } from "./support";

async function asHost(page: Page, path = "/") {
  failOnPageErrors(page);
  await page.route(/\/(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '<script type="module" src="/src/main.tsx">',
      '<script type="module" src="/e2e/host-identity.fixture.ts">',
    );
    await route.fulfill({ response, body });
  });
  await page.goto(path);
}

/** No quokka drawn, no quokka mark, no pose, and no quokka in the shell's
 * words. The demo vault's notes are synthetic content, not the shell, and one
 * of them is about the quokka, so note text and titles are left out. */
async function expectNoQuokka(page: Page) {
  await expect(page.locator(".quokka, .quokka-mark, [data-pose]")).toHaveCount(0);
  const shellText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(".cm-editor, .tabstrip, .main-tree, [data-note-id], .sb-list")
      .forEach((n) => n.remove());
    return clone.textContent ?? "";
  });
  expect(shellText).not.toMatch(/quokka/i);
}

test("the workspace names the host, starts on its family and draws no quokka", async ({ page }) => {
  await asHost(page);
  await page.locator(".tabstrip").first().waitFor();
  await expect(page).toHaveTitle("Example Host");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^ocean-/);
  await expect(page.locator(".sb-home-dashboard-head")).toContainText("Example Host activity");
  // the host's mark where the search field showed the quokka mark
  await expect(page.locator(".host-product-mark [data-host-mark]").first()).toBeVisible();
  await expectNoQuokka(page);

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").first().click();
  // the twin has no vault for chat, so its empty state stands where the
  // composer would; the composer's own words are routed and checked by
  // check:product-name
  await expect(page.locator(".chat-surface .list-empty")).toBeVisible();
  await expectNoQuokka(page);
});

test("Settings › Appearance has no quokka studio and no quokka trails", async ({ page }) => {
  await asHost(page);
  await page.locator(".tabstrip").first().waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Conversation navigator" }).getByRole("radio"),
  ).toHaveCount(2);
  await expectNoQuokka(page);
  await page.getByRole("button", { name: "About Example Host", exact: true }).click();
  await expectNoQuokka(page);
});

test("first run names the host and shows no quokka on any screen", async ({ page }) => {
  await asHost(page, "/?onboarding");
  await expect(page.getByRole("heading", { name: "Make Example Host yours." })).toBeVisible();
  await expect(page.getByText("What should Example Host call you?")).toBeVisible();
  await expectNoQuokka(page);
  await page.getByRole("button", { name: "Skip setup" }).click();
  const prompt = page.getByRole("dialog", { name: "Example Host needs a folder for your notes" });
  await expect(prompt).toBeVisible();
  await expectNoQuokka(page);
  await prompt.getByRole("button", { name: /Choose a folder/ }).click();
  await expect(page.getByRole("dialog", { name: "Thank you for trying Example Host" })).toBeVisible();
  await expectNoQuokka(page);
});
