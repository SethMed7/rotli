// The Tasks surface (regroomed 2026-09-18). Outside the Mac app the projection
// and the check-off run in TypeScript (services/webTasks.ts, the corpus.rs
// twin), so Rotli Web and this twin show real tasks instead of an empty list.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("tasks group under their note, fold, search, and checking one off edits the note", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "Tasks" }).first().click();
  const group = page.locator(".task-group", { hasText: "rotli — notes first" });
  await expect(group.locator(".task-row")).toHaveCount(2);

  // one magnifier, not the browser's beside ours; search narrows to the matching task
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toHaveAttribute("type", "text");
  await search.fill("corpus");
  await expect(group.locator(".task-row")).toHaveCount(1);
  await expect(group.locator(".task-row")).toContainText("Plain .md files on disk");
  await search.fill("");

  // a note folds away and back
  await group.getByRole("button", { name: /Hide tasks in/ }).click();
  await expect(group.locator(".task-row")).toHaveCount(0);
  await group.getByRole("button", { name: /Show tasks in/ }).click();
  await expect(group.locator(".task-row")).toHaveCount(2);

  // the help line is behind the ?
  await expect(page.locator(".task-intro")).toHaveCount(0);
  await page.getByRole("button", { name: "What is this list?" }).click();
  await expect(page.locator(".task-intro")).toContainText("Archived");

  // checking one off is a real edit: it leaves the list, and the note shows it done
  await group.getByRole("checkbox", { name: /Quick capture from anywhere/ }).click();
  await expect(group.locator(".task-row")).toHaveCount(1);
  await group.locator(".task-note").click();
  const line = page.locator(".cm-line", { hasText: "Quick capture from anywhere" });
  await expect(line.locator(".rotli-check.done")).toHaveCount(1);
  // the other task is untouched
  const other = page.locator(".cm-line", { hasText: "Plain .md files" });
  await expect(other.locator(".rotli-check.done")).toHaveCount(0);
});
