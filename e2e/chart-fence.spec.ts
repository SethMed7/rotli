// The ```chart fence (SYNTAX.md, 2026-10-05): a slash command inserts a
// starter and opens its Edit form; Apply rewrites only the fence body; a chart
// Rotli can't read fails closed with its reason and its source. Driven through
// real controls — the New chooser, the slash menu, the form's inputs.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

async function newMarkdownNote(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page.locator(".ni-surface").getByRole("button", { name: "New Markdown note" }).click();
  const editor = page.locator(".cm-content").last();
  await expect(editor).toBeVisible();
  await editor.click();
  return editor;
}

test("Bar chart from the slash menu draws, edits in its form, and Apply rewrites the fence", async ({
  page,
}) => {
  await gotoApp(page);
  const editor = await newMarkdownNote(page);
  await page.keyboard.insertText("/bar");
  await page.getByRole("menuitem", { name: /Bar chart/ }).click();

  const block = page.locator(".rotli-render-block[data-lang='chart']");
  await expect(block.locator(".rotli-render-chart-title")).toHaveText("Hours this week");
  await expect(block.locator(".rotli-render-chart-canvas svg").first()).toBeVisible();

  // the starter opens its form: change Monday's writing hours and add a row
  const form = block.getByRole("group", { name: "Edit chart" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: "Row 1, Writing" }).fill("9");
  await form.getByRole("button", { name: "Add a row" }).click();
  await form.getByRole("textbox", { name: "Row 4 label" }).fill("Thu");
  await form.getByRole("textbox", { name: "Row 4, Writing" }).fill("5");
  await form.getByRole("textbox", { name: "Row 4, Reading" }).fill("abc");
  await form.getByRole("button", { name: "Apply the chart" }).click();
  // the form refuses what the fence would refuse, and keeps the edits
  await expect(form.getByRole("alert")).toHaveText("“abc” in row 4 isn’t a number.");
  await form.getByRole("textbox", { name: "Row 4, Reading" }).fill("1");
  await form.getByRole("button", { name: "Apply the chart" }).click();
  await expect(block.getByRole("group", { name: "Edit chart" })).toHaveCount(0);

  // the source is the canonical form, rewritten in place
  await block.locator(".rotli-render-chart-title").click();
  await expect(editor).toContainText("Mon, 9, 1");
  await expect(editor).toContainText("Thu, 5, 1");
  await expect(editor).toContainText("type: bar");
});

test("a chart Rotli can't read shows its reason and its source, untouched", async ({ page }) => {
  await gotoApp(page);
  const editor = await newMarkdownNote(page);
  await page.keyboard.insertText("Before\n\n```chart\ntype: radar\n\nX, Y\na, 1\n```\n\nAfter");
  await page.getByText("Before").click();

  const refused = page.locator(".rotli-render-chart-refused");
  await expect(refused.locator(".rotli-render-error")).toContainText("“radar” isn’t a chart type");
  await expect(refused.locator("pre")).toContainText("type: radar");
  // Edit opens the source to fix by hand, never a form over a guess
  await page
    .locator(".rotli-render-block[data-lang='chart']")
    .getByRole("button", { name: "Edit chart" })
    .click();
  await expect(page.getByRole("group", { name: "Edit chart" })).toHaveCount(0);
  await expect(editor).toContainText("type: radar");
});

test("a pie chart draws its slices", async ({ page }) => {
  await gotoApp(page);
  await newMarkdownNote(page);
  await page.keyboard.insertText("/pie");
  await page.getByRole("menuitem", { name: /Pie chart/ }).click();
  const block = page.locator(".rotli-render-block[data-lang='chart']");
  await expect(block.locator(".rotli-render-chart-title")).toHaveText("Where the time went");
  await expect
    .poll(() => block.locator(".rotli-render-chart-canvas svg path").count())
    .toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: "test-results/chart-pie.png" });
});

test("typing above a chart keeps its drawing and its half-filled form", async ({ page }) => {
  await gotoApp(page);
  const editor = await newMarkdownNote(page);
  await page.keyboard.insertText("Intro\n/bar");
  await page.getByRole("menuitem", { name: /Bar chart/ }).click();
  const block = page.locator(".rotli-render-block[data-lang='chart']");
  const form = block.getByRole("group", { name: "Edit chart" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: "Row 1, Writing" }).fill("7");

  // an edit above shifts the chart's place in the note
  await editor.getByText("Intro").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" and more");
  await expect(editor).toContainText("Intro and more");

  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Row 1, Writing" })).toHaveValue("7");
  // and Apply still finds its fence
  await form.getByRole("button", { name: "Apply the chart" }).click();
  await expect(block.getByRole("group", { name: "Edit chart" })).toHaveCount(0);
  await block.locator(".rotli-render-chart-title").click();
  await expect(editor).toContainText("Mon, 7, 1");
});
