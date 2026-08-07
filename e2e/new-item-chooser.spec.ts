// The ⌘N chooser tab (Seth, 2026-07-29): a blank new tab with no type — you
// choose Markdown / Document / Sheet / Board / Mermaid. Driven through the
// palette action (real controls; CI has no Meta key for the chord).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the chooser tab offers every kind and becomes what you pick", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();

  const chooser = page.locator(".ni-surface");
  await expect(chooser).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("New…");
  await expect(chooser.getByRole("button", { name: "New Chat" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "New Mermaid diagram" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "New Board" })).toBeVisible();
  // every card wears its digit (Chat is 1 — "cmd+n then 1 for chat")
  await expect(chooser.getByRole("button", { name: "New Chat" }).locator(".ni-key")).toHaveText("1");

  // picking Markdown replaces the chooser with a real note tab
  await chooser.getByRole("button", { name: "New Markdown note" }).click();
  await expect(page.locator(".ni-surface")).toHaveCount(0);
  await expect(page.locator(".cm-content").last()).toBeVisible();
});

test("the chooser answers a bare digit press — no click needed", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();

  // the surface takes focus on open, so the digit lands without a click;
  // 2 = Markdown note (1 is Chat)
  await expect(page.locator(".ni-surface")).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.locator(".ni-surface")).toHaveCount(0);
  await expect(page.locator(".cm-content").last()).toBeVisible();
});

test("the chooser fills its pane instead of collapsing to a sliver", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();

  const chooser = page.locator(".ni-surface");
  await expect(chooser).toBeVisible();
  const body = page.locator("[data-pane-body]").first();
  const bodyBox = await body.boundingBox();
  const surfaceBox = await chooser.boundingBox();
  const innerBox = await chooser.locator(".ni-inner").boundingBox();
  const cardBox = await chooser.getByRole("button", { name: "New Chat" }).boundingBox();
  if (!bodyBox || !surfaceBox || !innerBox || !cardBox) throw new Error("chooser has no layout");

  // the surface is a flex child of .pane-body — it must GROW to the pane, not
  // shrink to its (size-contained, therefore zero) content width
  expect(surfaceBox.width).toBeGreaterThan(bodyBox.width - 2);
  // and the content column inside it is a real column, not a 4-character sliver
  expect(innerBox.width).toBeGreaterThan(300);
  // cards are cards: wide enough for their label, tall enough for glyph + copy
  expect(cardBox.width).toBeGreaterThan(120);
  expect(cardBox.height).toBeGreaterThan(60);
});

test("a Mermaid diagram item is born with the starter fence", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("New Mermaid");
  await page.locator(".prow", { hasText: "New Mermaid diagram" }).click();
  // the note opens with the rendered starter diagram in place
  await expect(page.locator(".rotli-render-mermaid-trigger")).toBeVisible();
});

test("an item chosen after selecting a Main folder is filed in that folder", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Sketches");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");

  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Sketches" });
  await folder.click();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  // Browser mode cannot invoke the native board creator. Markdown takes the
  // same createManagedItem → presenter.fileInMain path after creation, so it
  // proves the folder/chooser wiring without pretending a filesystem write ran.
  await page.locator(".ni-surface").getByRole("button", { name: "New Markdown note" }).click();

  const folderContents = folder.locator("..");
  await expect(folderContents.locator(".main-row", { hasText: "Untitled" })).toHaveCount(1);
});

test("an Excalidraw board asks for its name before creation", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page.locator(".ni-surface").getByRole("button", { name: "New Board" }).click();

  const dialog = page.getByRole("dialog", { name: "Name Excalidraw board" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Board name" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Create board" })).toBeDisabled();
});
