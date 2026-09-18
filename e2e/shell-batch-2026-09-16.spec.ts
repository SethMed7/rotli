// The rest of the owner's 2026-09-16 shell batch, proven in the browser twin:
// Delete folder in Main, the view tag on All notes rows, flat header actions,
// and wide ordered markers. (Copying a chat selection as Markdown needs a
// thread with replies, which the twin cannot produce; its rule is unit-tested
// in chatThreadModel.test.ts and the DOM wiring is native-checked.)

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

async function newMainFolder(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill(name);
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: name });
  await expect(folder).toBeVisible();
  return folder;
}

test("Delete folder: an empty folder goes away; a full one trashes its items first", async ({ page }) => {
  await gotoApp(page);
  const empty = await newMainFolder(page, "Scratch");
  await empty.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Delete folder", exact: true }).click();
  await expect(page.locator('.main-tree [data-main-folder="1"]', { hasText: "Scratch" })).toHaveCount(0);

  const full = await newMainFolder(page, "Review");
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" });
  await pointerDrag(page, source, await centerOf(full));
  await expect(page.locator('[data-main-id="main:Review"] + *', { hasText: "Q3 priorities" })).toBeVisible();
  await full.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Delete folder…" }).click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /Move 1 item to Trash and delete folder/ })
    .click();
  await expect(page.locator('.main-tree [data-main-folder="1"]', { hasText: "Review" })).toHaveCount(0);
  await page.locator(".frow", { hasText: "Trash" }).first().click();
  await expect(
    page.locator(".system-browser .fdr-tile", { hasText: "Q3 priorities — Northstar" }),
  ).toBeVisible();
});

test("All notes stays global and tags a row with the named view that owns it", async ({ page }) => {
  await gotoApp(page);
  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Research");
  await page.getByRole("button", { name: "Save" }).click();

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const row = page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" });
  await expect(row.locator(".rr-view")).toHaveCount(0);
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to view" }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Research" }).click();
  await expect(row.locator(".rr-view")).toHaveText("Research");
  // still listed with every other note: the list did not filter to the view
  await expect(page.locator(".recent-row", { hasText: "Pricing decision" })).toBeVisible();
});

test("note header actions carry no surface, and a wide ordered marker widens its column", async ({
  page,
}) => {
  await gotoApp(page);
  const aa = page.getByRole("button", { name: "Aa", exact: true }).first();
  await expect(aa).toBeVisible();
  await expect(aa).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.getByRole("button", { name: "New folder in Main" }).waitFor();
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("9. ninth item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("tenth item");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  // "9." and "10." hang in ONE right-aligned column (2026-09-18): the numbers
  // end on the same edge, so the text starts on the same one
  const markers = page.locator(".rotli-marker.num");
  await expect(markers).toHaveText(["9.", "10."]);
  const nine = (await markers.nth(0).boundingBox())!;
  const ten = (await markers.nth(1).boundingBox())!;
  expect(Math.abs(nine.x + nine.width - (ten.x + ten.width))).toBeLessThan(0.5);
  expect(Math.abs(nine.x - ten.x)).toBeLessThan(0.5);
  await expect(page.locator(".rotli-marker.num.wide")).toHaveCount(0);
});
