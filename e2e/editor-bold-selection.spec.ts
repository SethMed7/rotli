// A reader's report (2026-09-28): triple-clicking a line and pressing Bold left
// the line plain and put `****` in front of the next line's bullet. The
// selection runs to the start of the next line; Bold now marks the line's own
// text, and a selection across lines bolds each line with its bullet intact.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

const NOTE = "Launch plan\n\nBudgets & Purchasing Process\n- $50 to $100\n- need proof of results";

async function rawText(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Aa", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await page.keyboard.press("Escape");
  return (await page.locator(".cm-content").last().innerText()).replace(/ /g, " ");
}

async function newNote(page: Page) {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText(NOTE);
}

const boldButton = (page: Page) => page.getByRole("button", { name: /^Bold/ }).last();

test("a triple-clicked line bolds itself, and the bullet below stays a bullet", async ({ page }) => {
  await newNote(page);
  await page.locator(".cm-line", { hasText: "Budgets & Purchasing Process" }).click({ clickCount: 3 });
  await boldButton(page).click();

  const raw = await rawText(page);
  expect(raw).toContain("**Budgets & Purchasing Process**\n- $50 to $100");
  expect(raw).not.toContain("****");
});

test("Bold twice across lines puts every line back as it was", async ({ page }) => {
  await newNote(page);
  const first = page.locator(".cm-line", { hasText: "Budgets & Purchasing Process" });
  const last = page.locator(".cm-line", { hasText: "need proof of results" });
  const [a, b] = [await first.boundingBox(), await last.boundingBox()];
  await page.mouse.move(a!.x + 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width - 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  await boldButton(page).click();
  await expect(boldButton(page)).toBeVisible();
  // Bold again, on the selection the first press left: every line comes back
  await boldButton(page).click();

  const raw = await rawText(page);
  expect(raw).toContain("Budgets & Purchasing Process\n- $50 to $100\n- need proof of results");
  expect(raw).not.toContain("**");
});

test("a selection across lines bolds every line's text and keeps each bullet", async ({ page }) => {
  await newNote(page);
  const first = page.locator(".cm-line", { hasText: "Budgets & Purchasing Process" });
  const last = page.locator(".cm-line", { hasText: "need proof of results" });
  const [a, b] = [await first.boundingBox(), await last.boundingBox()];
  await page.mouse.move(a!.x + 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width - 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  await boldButton(page).click();

  const raw = await rawText(page);
  expect(raw).toContain("**Budgets & Purchasing Process**\n- **$50 to $100**\n- **need proof of results**");
});

// The same reader, a minute later: bold a word, keep typing plain text after
// it, select the whole line, Bold. That added stray stars
// (`****hello** okay world**`); now the line becomes one bold span.
test("bolding a line that is already partly bold makes it one bold span", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("Draft\n\nhello");
  await page.locator(".cm-line", { hasText: "hello" }).dblclick();
  await boldButton(page).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" okay world whayt is");
  await page.locator(".cm-line", { hasText: "okay world" }).click({ clickCount: 3 });
  await boldButton(page).click();

  const raw = await rawText(page);
  expect(raw).toContain("**hello okay world whayt is**");
  expect(raw).not.toContain("***");
});
