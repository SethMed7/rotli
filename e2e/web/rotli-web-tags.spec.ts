import { expect, type Page, test } from "@playwright/test";

import { readOpfsFile, startWithFolder } from "./support";

// Synthetic vault: one locked note (the person's lane works on it), one
// tagged note to filter by, and the marker that makes it a Rotli vault.
const MARKER = '{"id":"mx_e2etags000001","contract":"3.4"}\n';
const LOCKED =
  "---\nid: tags-locked\ncreated: 2026-11-20\nlocked: true\nmood: calm # kept\ntags: [garden]\n---\n# Garden plan\n\nSeeds and soil.\n";
const OTHER = "---\nid: tags-other\ncreated: 2026-11-21\ntags: [kitchen]\n---\n# Kitchen list\n\nPans.\n";
const MAIN = '{"version":1,"tree":[{"note":"tags-locked"},{"note":"tags-other"}]}';

async function open(page: Page, title: string) {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill(title);
  await page.locator(".prow", { hasText: title }).first().click();
  await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(title);
}

test("the person tags a locked note from its header and removes a tag", async ({ page }) => {
  const path = "wiki/garden-plan.md";
  await startWithFolder(page, {
    "memex.json": MARKER,
    [path]: LOCKED,
    "wiki/kitchen-list.md": OTHER,
    ".rotli/main.json": MAIN,
  });
  await open(page, "Garden plan");
  const tags = page.getByRole("group", { name: "Tags" });
  await expect(tags.getByText("#garden")).toBeVisible();

  await tags.getByRole("button", { name: "+ Tag" }).click();
  await tags.getByRole("textbox", { name: "New tags" }).fill("#Spring seeds");
  await page.keyboard.press("Enter");
  await expect(tags.getByText("#Spring")).toBeVisible();
  await expect(tags.getByText("#seeds")).toBeVisible();
  await expect
    .poll(() => readOpfsFile(page, path))
    .toBe(LOCKED.replace("tags: [garden]", "tags: [garden, Spring, seeds]"));

  // a value that would write another metadata line is refused, in place
  await tags.getByRole("button", { name: "+ Tag" }).click();
  await tags.getByRole("textbox", { name: "New tags" }).fill("ai_edit:true");
  await page.keyboard.press("Enter");
  await expect(tags.getByRole("alert")).toContainText("can't be a tag");
  await page.keyboard.press("Escape");
  await expect(tags.getByRole("alert")).toHaveCount(0);

  await tags.getByRole("button", { name: "Remove tag garden" }).click();
  await expect(tags.getByText("#garden")).toHaveCount(0);
  await expect
    .poll(() => readOpfsFile(page, path))
    .toBe(LOCKED.replace("tags: [garden]", "tags: [Spring, seeds]"));
});

test("All notes filters to the notes that carry a tag", async ({ page }) => {
  await startWithFolder(page, {
    "memex.json": MARKER,
    "wiki/garden-plan.md": LOCKED,
    "wiki/kitchen-list.md": OTHER,
    ".rotli/main.json": MAIN,
  });
  await open(page, "Garden plan");
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const list = page.locator(".allnotes");
  await expect(list.locator(".recent-list")).toContainText("Kitchen list");
  const filter = page.getByRole("group", { name: "Filter by tag" });
  await filter.getByRole("button", { name: "#garden, 1 note" }).click();
  await expect(filter.getByRole("button", { name: "#garden, 1 note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(list.locator(".recent-list")).toContainText("Garden plan");
  await expect(list.locator(".recent-list")).not.toContainText("Kitchen list");
  await filter.getByRole("button", { name: "All", exact: true }).click();
  await expect(list.locator(".recent-list")).toContainText("Kitchen list");
});
