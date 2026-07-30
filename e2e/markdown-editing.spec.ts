import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

const TABLE_NOTE = `# Table editing

| Model | License |
| ----- | ------- |
| Inkling | Apache 2.0 |
| GLM-5.2 | Open |
`;

const WRAPPED_TABLE_NOTE = `# Wrapped table editing

| Corpay API | Purpose | Auth | Env vars |
| ---------- | ------- | ---- | -------- |
| Cards API | Issue/manage cards | Okta OAuth2 client-credentials | \`CORPAY_CARDS_BASE_URL\`, \`CORPAY_CARDS_TOKEN_URL\`, \`CORPAY_CARDS_CLIENT_ID\`, \`CORPAY_CARDS_CLIENT_SECRET\`, \`CORPAY_CARDS_SCOPE\` |
| Webhooks | Real-time events | Cognito subscribe + HMAC verify | \`CORPAY_WEBHOOK_SIGNATURE_SECRET\`, \`CORPAY_WEBHOOK_API_KEY\`, \`CORPAY_WEBHOOK_API_KEY_HEADER\` |
`;

test("clicking a Markdown table cell edits inside the rendered table", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  await expect(table).toBeVisible();
  await table.getByRole("cell", { name: "Inkling" }).click();

  const cellEditor = table.getByRole("textbox", { name: "Edit Model row 1" });
  await expect(cellEditor).toBeVisible();
  await expect(table).toBeVisible();
  await expect(page.locator(".rotli-table-rawline")).toHaveCount(0);

  await cellEditor.fill("Inkling 2");
  await cellEditor.press("Tab");
  await expect(table).toContainText("Inkling 2");
  await expect(table.getByRole("textbox", { name: "Edit License row 1" })).toBeFocused();

  await table.getByRole("textbox", { name: "Edit License row 1" }).press("Tab");
  await expect(table.getByRole("textbox", { name: "Edit Model row 2" })).toBeFocused();
  await table.getByRole("textbox", { name: "Edit Model row 2" }).press("Tab");
  await table.getByRole("textbox", { name: "Edit License row 2" }).press("Tab");
  await expect(table.getByRole("textbox", { name: "Edit Model row 3" })).toBeFocused();
  await expect(table.locator("tbody tr")).toHaveCount(3);
});

test("dragging a column boundary resizes the column; double-click resets", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  await expect(table).toBeVisible();
  const firstHeader = table.locator("th").first();
  const before = await firstHeader.boundingBox();
  if (!before) throw new Error("no header box");

  // press ON the boundary between the two columns and drag 80px right
  await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 78, before.y + before.height / 2, { steps: 4 });
  await page.mouse.up();

  const after = await firstHeader.boundingBox();
  if (!after) throw new Error("no header box after drag");
  expect(after.width).toBeGreaterThan(before.width + 60);
  // the boundary press resized — it must not have opened the cell editor
  await expect(table.locator(".rotli-md-cell-input")).toHaveCount(0);

  // double-click the boundary → back to auto layout
  await page.mouse.dblclick(after.x + after.width - 2, after.y + after.height / 2);
  const restored = await firstHeader.boundingBox();
  if (!restored) throw new Error("no header box after reset");
  expect(Math.abs(restored.width - before.width)).toBeLessThan(12);
});

test("editing a wrapped table cell preserves the table's shape", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(WRAPPED_TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  const target = table.getByRole("cell", { name: /CORPAY_CARDS_BASE_URL/ });
  const row = target.locator("xpath=..");
  const beforeTable = await table.boundingBox();
  const beforeCell = await target.boundingBox();
  const beforeRow = await row.boundingBox();
  expect(beforeTable).not.toBeNull();
  expect(beforeCell).not.toBeNull();
  expect(beforeRow).not.toBeNull();

  await target.click();
  const cellEditor = table.getByRole("textbox", { name: "Edit Env vars row 1" });
  await expect(cellEditor).toBeVisible();
  expect(await cellEditor.evaluate((node) => node.tagName)).toBe("TEXTAREA");

  const duringTable = await table.boundingBox();
  const duringCell = await cellEditor.locator("xpath=..").boundingBox();
  const duringRow = await cellEditor.locator("xpath=../..").boundingBox();
  expect(Math.abs((duringTable?.width ?? 0) - (beforeTable?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((duringCell?.width ?? 0) - (beforeCell?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(duringRow?.height ?? 0).toBeGreaterThanOrEqual((beforeRow?.height ?? 0) - 1);
});

test("an exact note-title wikilink opens on an ordinary click", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("# Link test\n\n[[Pricing decision]]");

  await page.locator(".rotli-wikilink", { hasText: "Pricing decision" }).click();
  await expect(page.locator(".cm-content")).toContainText("Free local forever.");
});

test("raw Markdown uses the Rotli syntax grammar without changing source", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(
    "# Model landscape\n\n- **Inkling** belongs to [[Strategy]]\n\n```mermaid\nflowchart LR\n  A --> B\n```",
  );

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();

  await expect(page.locator(".cm-editor.rotli-raw-mode")).toBeVisible();
  await expect(page.locator(".rotli-raw-heading")).toContainText("Model landscape");
  await expect(page.locator(".rotli-raw-strong")).toContainText("**Inkling**");
  await expect(page.locator(".rotli-raw-accent")).not.toHaveCount(0);
  await expect(page.locator(".rotli-raw-code-line")).toHaveCount(4);
  await expect(editor).toContainText("flowchart LR");
});

test("bullet outdent works on app-made AND tab-indented (foreign) lists", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();

  // the app's own flow: nest with Tab, come back with Shift-Tab, keep typing
  await page.keyboard.type("- alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("child");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("gamma");
  await expect(editor).toContainText("gamma");

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  // a foreign note indented with TABS (external editors, LLM output): the
  // bullet must render as a bullet and Shift-Tab must outdent it — this was
  // completely dead (raw text, no-op Shift-Tab; Seth, 2026-07-28)
  await page.keyboard.insertText("- alpha\n\t- child");
  await expect(page.locator(".rotli-li")).toHaveCount(2); // BOTH lines are bullets
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("!");
  await expect(editor).toContainText("child!");

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  // tasks keep their checkboxes through an outdent
  await page.keyboard.insertText("- [ ] a\n  - [x] b");
  await expect(page.locator(".rotli-check")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".rotli-check")).toHaveCount(2);
});
