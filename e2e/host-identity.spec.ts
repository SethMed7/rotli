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
  // the island intro plays its scene and word with no quokka shell
  await expect(page.getByTestId("onboarding-intro")).toBeVisible();
  await expect(page.locator(".onb-intro-quokka")).toHaveCount(0);
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

test("a host's plain first run: its order and words, its blocks, and no scenery", async ({ page }) => {
  await asHost(page, "/?onboarding&plain");
  await expect(page.locator(".onb[data-look='plain']")).toBeVisible();
  await expect(page.getByText("1 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Make Example Host yours." })).toBeVisible();
  // the host's block, and no theme choice, companion, scenery or intro
  await expect(page.getByRole("group", { name: "Example Host tools" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Appearance mode" })).toHaveCount(0);
  await expect(page.locator(".setup-companion, .onb-scenery, [data-testid='onboarding-intro']")).toHaveCount(
    0,
  );
  await expectNoQuokka(page);

  await page.getByRole("button", { name: /^Connect Example Sync/ }).click();
  await expect(page.getByText("2 of 2")).toBeVisible();
  await expect(page.locator(".setup-progress")).toContainText("Connect");
  await expect(
    page.getByRole("heading", { name: "Connect Example Sync, then pick a folder." }),
  ).toBeVisible();
  // the step waits for the host's row and for a folder
  const finish = page.getByRole("button", { name: /^Finish setup/ });
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Choose folder…" }).click();
  await expect(page.getByRole("button", { name: "Choose another…" })).toBeVisible();
  await expect(finish).toBeEnabled();
  await expectNoQuokka(page);
  await finish.click();

  // the thank-you is words alone
  const thanks = page.getByRole("dialog", { name: "Thank you for trying Example Host" });
  await expect(thanks.locator(".thanks-banner--plain")).toBeVisible();
  await expect(thanks.locator("svg.thanks-banner-sky, .thanks-banner-horizon")).toHaveCount(0);
});

test("Back walks a host's order, and a host's own step sits where its order puts it", async ({ page }) => {
  await asHost(page, "/?onboarding&plain&hoststep");
  await expect(page.getByText("1 of 3")).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByRole("heading", { name: "One more thing." })).toBeVisible();
  await expect(page.getByText("2 of 3")).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByText("3 of 3")).toBeVisible();
  await page.getByRole("button", { name: /^Back/ }).click();
  await expect(page.getByRole("heading", { name: "One more thing." })).toBeVisible();
  await page.getByRole("button", { name: /^Back/ }).click();
  await expect(page.getByRole("heading", { name: "Make Example Host yours." })).toBeVisible();
});

test("Skip setup on a plain first run asks for a folder alone, with no scene", async ({ page }) => {
  await asHost(page, "/?onboarding&plain");
  await page.getByRole("button", { name: "Skip setup" }).click();
  const prompt = page.getByRole("dialog", { name: "Example Host needs a folder for your notes" });
  await expect(prompt).toBeVisible();
  await expect(
    page.locator(".vault-needed[data-look='plain'] .pane-scene, .vault-needed .pane-empty-scene"),
  ).toHaveCount(0);
  await expectNoQuokka(page);
});
