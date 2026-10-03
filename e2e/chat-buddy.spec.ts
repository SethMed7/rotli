// The chat buddy (the owner, 2026-10-02: "just use the quokkas in chats and
// like settings/onboarding that's it. In the chat user doesn't get a choice
// its like a chat buddy but they can decorate it"). Chat always has its
// quokka; its pose follows the chat; Settings decorates it with a live
// preview; there is no switch and no mood picker. A reply's thinking → done
// arc needs a chat runtime, which the browser twin lacks: the web lane proves
// it through a fake Rotli Helper (e2e/web/rotli-helper.spec.ts).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Settings decorates the buddy with a live preview, and Chat wears it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();

  // no switch to hide it, and no mood to pick: Chat picks the pose
  await expect(page.getByRole("heading", { name: "Chat buddy" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Companion/ })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: /idle mood/ })).toHaveCount(0);

  const preview = page.getByTestId("chat-buddy-preview").locator(".quokka");
  await expect(preview).toHaveAttribute("data-pose", "chat");
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(0);

  await page.getByRole("radio", { name: /^Fern/ }).click();
  await expect(preview).toHaveAttribute("style", /--quokka-fill: #6FA68B/i);
  await page
    .getByRole("radiogroup", { name: "Quokka accessory" })
    .getByRole("radio", { name: /^Glasses/ })
    .click();
  await expect(preview.locator(".quokka-accessory-layer")).toHaveCount(1);
  await page.getByRole("radio", { name: "Black" }).click();
  await expect(page.getByRole("radio", { name: "Black" })).toHaveAttribute("aria-checked", "true");
  const strip = page.getByLabel("Automatic quokka expressions");
  await expect(strip.locator(".quokka-accessory-layer")).toHaveCount(4);

  // Chat's own buddy wears the same decoration, in the pose of its moment
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();
  const buddy = page.locator(".chat-empty .chat-buddy");
  await expect(buddy).toBeVisible();
  await expect(buddy).toHaveAttribute("data-pose", "listening");
  await expect(buddy).toHaveAttribute("style", /--quokka-fill: #6FA68B/i);
  await expect(buddy.locator(".quokka-accessory-layer")).toHaveCount(1);
});
