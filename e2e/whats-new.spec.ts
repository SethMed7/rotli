// What's new (2026-09-28): the palette reopens the newest release's highlights
// in a small card; a change that lives on one platform says which, the rest
// say nothing. The launch rule (once, after an update) is proven on Rotli Web
// in e2e/web/rotli-web-whats-new.spec.ts and by src/lib/whatsNew.test.ts.

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

type Highlight = { title: string; body: string; platform?: "mac" | "web" };
const notes = JSON.parse(readFileSync("src/assets/whats-new.json", "utf8")) as Record<string, Highlight[]>;
const newest = Object.keys(notes)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1)!;

test("the palette's What's new lists the newest release and marks one-platform changes", async ({ page }) => {
  await gotoApp(page);
  // a fresh browser twin is a first run: nothing opens on its own
  await expect(page.getByRole("dialog", { name: /What’s new in Rotli/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("What’s new");
  await page.locator(".prow", { hasText: "What’s new in Rotli" }).first().click();

  const dialog = page.getByRole("dialog", { name: `What’s new in Rotli ${newest}` });
  await expect(dialog.getByRole("listitem")).toHaveCount(notes[newest]!.length);
  for (const item of notes[newest]!) {
    const row = dialog.getByRole("listitem").filter({ hasText: item.title });
    const label =
      item.platform === "mac" ? "Mac app only" : item.platform === "web" ? "Rotli Web only" : null;
    if (label) await expect(row.locator(".whats-new-platform")).toHaveText(label);
    else await expect(row.locator(".whats-new-platform")).toHaveCount(0);
  }
  await expect(dialog.getByRole("button", { name: "See everything new" })).toBeVisible();

  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toHaveCount(0);
});
