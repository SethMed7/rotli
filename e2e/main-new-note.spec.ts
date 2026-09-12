// Regression for the Main creation context: opening a Main reference must make
// that virtual folder the target for Command-T. The note itself still lives in
// the memex intake lane; Main receives a reference only once it has content.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test("Command-T keeps a blank draft out of Main, then files its first saved content", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" });
  const mainRoot = page.locator('[data-main-id="main:"]');
  await pointerDrag(page, source, await centerOf(mainRoot));

  const mainNote = page.locator(".main-tree [data-main-id]", { hasText: "Q3 priorities — Northstar" });
  await mainNote.click();

  const tabs = page.getByRole("tab");
  const countBefore = await tabs.count();
  const untitledRows = page.locator(".main-tree [data-main-id]", { hasText: "Untitled" });
  const untitledBefore = await untitledRows.count();
  await page.keyboard.press("Meta+T");

  await expect(tabs).toHaveCount(countBefore + 1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Untitled");
  await expect(untitledRows).toHaveCount(untitledBefore);

  await page.keyboard.type("# Authored in Main");
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Authored in Main" })).toBeVisible();
});

test("closing an optimistic blank before creation settles leaves no Main row", async ({ page }) => {
  await gotoApp(page);

  const tabs = page.getByRole("tab");
  const tabCount = await tabs.count();
  const untitledRows = page.locator(".main-tree [data-main-id]", { hasText: "Untitled" });
  const untitledBefore = await untitledRows.count();

  await page.keyboard.press("Meta+T");
  await page.keyboard.press("Meta+W");
  await expect(tabs).toHaveCount(tabCount);

  // Let the authorized background creation/read/refresh lane finish. A close
  // during any of those awaits must discard the blank file instead of filing
  // an orphan after its tab is already gone.
  await page.waitForTimeout(800);
  await expect(untitledRows).toHaveCount(untitledBefore);
});

test("a Main right-click trashes the whole gathered selection", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Q3 priorities — Northstar", "Groceries"]) {
    await pointerDrag(page, page.locator(".recent-row", { hasText: title }), await centerOf(mainRoot));
  }

  const first = page.locator(".main-tree [data-main-id]", { hasText: "Q3 priorities — Northstar" });
  const second = page.locator(".main-tree [data-main-id]", { hasText: "Groceries" });
  await first.click({ modifiers: ["Meta"] });
  await second.click({ modifiers: ["Meta"] });
  await expect(page.locator(".main-tree .main-row.msel")).toHaveCount(2);

  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move 2 items to Trash" }).click();

  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
});

test("browsing reuses one preview tab; re-click keeps; typing keeps", async ({ page }) => {
  await gotoApp(page);
  // measure the strip while the PANES are visible (All-notes hides them)
  const tabs = page.locator(".tabslot");
  const before = await tabs.count();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();

  // click through two notes — ONE preview tab absorbs both
  await page.locator(".recent-row", { hasText: "Groceries" }).click();
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.locator(".tab.preview")).toHaveCount(1);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Quokka world" }).click();
  await expect(tabs).toHaveCount(before + 1); // reused, not appended

  // clicking the same note again KEEPS the tab
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Quokka world" }).click();
  await expect(page.locator(".tab.preview")).toHaveCount(0);

  // the next browse gets a fresh preview tab beside the kept one
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Groceries" }).click();
  await expect(tabs).toHaveCount(before + 2);

  // typing into the previewed note keeps it too
  await page.locator(".cm-content").last().click();
  await page.keyboard.type("x");
  await expect(page.locator(".tab.preview")).toHaveCount(0);
});

test("New lands beside the open note, and at the Main root when nothing is open", async ({ page }) => {
  await gotoApp(page);

  // stock Main: one note inside a folder
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  await pointerDrag(
    page,
    page.locator(".recent-row", { hasText: "Groceries" }).first(),
    await centerOf(mainRoot),
  );
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });
  await pointerDrag(page, page.locator(".main-row", { hasText: "Groceries" }), await centerOf(folder));
  const groceries = page.locator(".main-row", { hasText: "Groceries" });
  const nested = await groceries.evaluate((el) => (el as HTMLElement).style.paddingLeft);

  // the note inside the folder is open → New lands beside it
  await groceries.click();
  await page.getByRole("button", { name: /^New note in / }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Untitled");
  await page.locator(".cm-content").last().click();
  await page.keyboard.type("# Beside it");
  const beside = page.locator(".main-row", { hasText: "Beside it" });
  await expect(beside).toBeVisible();
  expect(await beside.evaluate((el) => (el as HTMLElement).style.paddingLeft)).toBe(nested);

  // close every tab → nothing open → New lands at the root, even though the
  // folder was the last place clicked
  const openTabs = page.getByRole("tab");
  while ((await openTabs.count()) > 0) {
    const tab = openTabs.first();
    await tab.hover(); // the × on an inactive tab is hover-revealed
    await tab.getByRole("button", { name: "Close tab — ⌘W" }).click({ force: true });
  }
  await expect(openTabs).toHaveCount(0);
  await page.getByRole("button", { name: /^New note in / }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Untitled");
  await page.locator(".cm-content").last().click();
  await page.keyboard.type("# At the root");
  const root = page.locator(".main-row", { hasText: "At the root" });
  await expect(root).toBeVisible();
  const rootPad = await root.evaluate((el) => (el as HTMLElement).style.paddingLeft);
  expect(rootPad).not.toBe(nested);
  expect(Number.parseInt(rootPad, 10)).toBeLessThan(Number.parseInt(nested, 10));
});
