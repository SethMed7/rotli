// Regression-layer handoff item 4 (docs/architecture/code-audit.md): Main
// add-drag. Covers the SHARED src/lib/mainAddDrag.ts module — the drag source
// here is a note-list row (src/components/noteListRow.tsx, "the All-notes
// list rows and (via tabDrag) editor tabs" per that file's own header comment)
// rather than the sidebar's own local implementation (see
// sidebar-cross-section-drag.spec.ts), so this exercises a genuinely different
// wiring of the same drop contract.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test("dragging an All-notes row into Main adds it there", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const row = page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" });
  await expect(row).toBeVisible();

  const mainRoot = page.locator('[data-main-id="main:"]');
  await expect(mainRoot).toContainText("arranged your way");

  await pointerDrag(page, row, await centerOf(mainRoot));

  await expect(
    page.locator(".main-tree [data-main-id]", { hasText: "Q3 priorities — Northstar" }),
  ).toBeVisible();
});

test("⌘-click gathers Main rows and one drag moves them all into a folder", async ({ page }) => {
  await gotoApp(page);

  // stock Main with three notes + a folder
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Launch checklist", "Groceries", "Quokka world"]) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });
  await expect(folder).toBeVisible();

  // ⌘-click two rows → both gather; drag one → both land in the folder
  await page.locator(".main-row", { hasText: "Groceries" }).click({ modifiers: ["Meta"] });
  await page.locator(".main-row", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".main-row.msel")).toHaveCount(2);
  await pointerDrag(page, page.locator(".main-row", { hasText: "Groceries" }), await centerOf(folder));
  const inFolder = page.locator('[data-main-id="main:Bundle"] ~ * .main-row, [data-main-id^="main:Bundle"]');
  await expect(page.locator(".main-row.msel")).toHaveCount(0); // selection cleared after the move
  // both notes now render under the folder (indented rows follow it)
  await expect(page.locator(".main-tree", { hasText: "Groceries" })).toBeVisible();
  await expect(page.locator(".main-tree", { hasText: "Quokka world" })).toBeVisible();
  void inFolder;
});

test("dropping a note just below a folder row takes it back out to the folder's level", async ({ page }) => {
  await gotoApp(page);

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
  const groceries = page.locator(".main-row", { hasText: "Groceries" });
  const rootPad = await groceries.evaluate((el) => (el as HTMLElement).style.paddingLeft);

  await pointerDrag(page, groceries, await centerOf(folder));
  const nestedPad = await groceries.evaluate((el) => (el as HTMLElement).style.paddingLeft);
  expect(nestedPad).not.toBe(rootPad);

  // the lower quarter of the folder row = "after the folder" (a sibling), not into it
  const box = await folder.boundingBox();
  if (!box) throw new Error("folder row has no box");
  await pointerDrag(page, groceries, { x: box.x + box.width / 2, y: box.y + box.height * 0.85 });
  expect(await groceries.evaluate((el) => (el as HTMLElement).style.paddingLeft)).toBe(rootPad);
  await expect(folder).toBeVisible();
});

// The owner, 2026-09-18: "I selected three files, dragged into the folder below;
// it only grabbed the one I was grabbing." The older test above never looked
// INSIDE the folder; this one does, by collapsing it.
test("three gathered Main rows dragged into a folder all land inside it", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  const titles = ["Launch checklist", "Groceries", "Quokka world"];
  for (const title of titles) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });
  await expect(folder).toBeVisible();

  for (const title of titles)
    await page.locator(".main-row", { hasText: title }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".main-row.msel")).toHaveCount(3);
  await pointerDrag(page, page.locator(".main-row", { hasText: "Groceries" }), await centerOf(folder));
  await expect(page.locator(".main-row.msel")).toHaveCount(0);

  // collapse the folder: everything inside it leaves the tree
  for (const title of titles)
    await expect(page.locator(".main-tree .main-row", { hasText: title })).toBeVisible();
  await folder.click();
  for (const title of titles)
    await expect(page.locator(".main-tree .main-row", { hasText: title })).toHaveCount(0);
});

// The likely shape of that report: a plain click opens A (it reads as selected),
// then ⌘-click gathers B and C. Finder counts A in; rotli did not, so dragging
// by A moved A alone.
test("the open note counts as selected once ⌘-click starts gathering", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  const titles = ["Launch checklist", "Groceries", "Quokka world"];
  for (const title of titles) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Bundle");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });

  await page.locator(".main-row", { hasText: "Launch checklist" }).click(); // opens it
  await page.locator(".main-row", { hasText: "Groceries" }).click({ modifiers: ["Meta"] });
  await page.locator(".main-row", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".main-row.msel")).toHaveCount(3);
  await pointerDrag(page, page.locator(".main-row", { hasText: "Launch checklist" }), await centerOf(folder));
  await folder.click(); // collapse: all three were inside
  for (const title of titles)
    await expect(page.locator(".main-tree .main-row", { hasText: title })).toHaveCount(0);
});

test("Add to folder files the whole selection, and New folder… is named in place", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  const titles = ["Launch checklist", "Groceries", "Quokka world"];
  for (const title of titles) {
    await pointerDrag(
      page,
      page.locator(".recent-row", { hasText: title }).first(),
      await centerOf(mainRoot),
    );
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  const inside = page.locator(".main-tree .main-row:not([data-main-folder])");
  const before = await inside.allTextContents();
  // gathered out of order on purpose: filing keeps the order Main lists them in
  for (const title of [...titles].reverse()) {
    await page.locator(".main-row", { hasText: title }).click({ modifiers: ["Meta"] });
  }
  await page.locator(".main-row", { hasText: "Groceries" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add 3 items to folder" }).click();
  await page.getByRole("menuitem", { name: "New folder…" }).click();
  // the sidebar opens the fresh folder's name for editing
  const name = page.locator(".main-tree input");
  await expect(name).toBeVisible();
  await name.fill("Bundle");
  await name.press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Bundle" });
  await expect(folder).toBeVisible();
  // inside it, in the order they were listed
  await expect(inside).toHaveText(before);
  await folder.click();
  await expect(inside).toHaveCount(0);

  // and an existing folder is offered by name
  await folder.click();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await pointerDrag(
    page,
    page.locator(".recent-row", { hasText: "Q3 priorities — Northstar" }).first(),
    await centerOf(mainRoot),
  );
  await page.locator(".main-row", { hasText: "Q3 priorities — Northstar" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to folder", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bundle", exact: true }).click();
  await folder.click();
  await expect(page.locator(".main-tree .main-row", { hasText: "Q3 priorities — Northstar" })).toHaveCount(0);
});

test("a gathered selection dragged out of the System browser lands in Main whole", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Assets" }).first().click();
  const groceries = page.locator(".system-browser .fdr-tile", { hasText: "Groceries" });
  await groceries.click();
  await page.locator(".system-browser .fdr-tile", { hasText: "Quokka world" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".system-browser .fdr-tile.sel")).toHaveCount(2);
  await pointerDrag(page, groceries, await centerOf(page.locator('[data-main-id="main:"]')));
  await expect(page.locator(".main-tree .main-row", { hasText: "Groceries" })).toBeVisible();
  await expect(page.locator(".main-tree .main-row", { hasText: "Quokka world" })).toBeVisible();
});
