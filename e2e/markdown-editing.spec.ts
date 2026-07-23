import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

const TABLE_NOTE = `# Table editing

| Model | License |
| ----- | ------- |
| Inkling | Apache 2.0 |
| GLM-5.2 | Open |
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
