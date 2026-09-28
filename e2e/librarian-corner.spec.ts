// The Librarian pill (2026-09-28, the owner: "look like it is coming out of
// something … show the whole time … in line with the arrow, to the left of
// it", and "a note about the Librarian only organizing, not chatting"). The
// pill is always in a note's corner beside the scroll-to-top arrow; the
// conversation opens above it and the pill closes it again.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 860 } });

test("the Librarian pill sits left of the arrow, and the panel opens above it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText(
    "# Long note\n\n" + Array.from({ length: 80 }, (_, i) => `Line ${i}.`).join("\n\n"),
  );
  await page
    .locator(".cm-scroller")
    .last()
    .evaluate((el) => el.scrollTo({ top: 1500 }));

  const pill = page.getByRole("button", { name: "Open the Librarian" });
  const arrow = page.getByRole("button", { name: "Scroll to top" });
  await expect(pill).toBeVisible();
  await expect(arrow).toBeVisible();
  const [p, a] = [(await pill.boundingBox())!, (await arrow.boundingBox())!];
  // same row, same height, the pill just left of the arrow
  expect(Math.abs(p.y + p.height - (a.y + a.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(p.height - a.height)).toBeLessThanOrEqual(1);
  expect(p.x + p.width).toBeLessThanOrEqual(a.x);
  expect(a.x - (p.x + p.width)).toBeLessThanOrEqual(12);

  await pill.click();
  const panel = page.getByRole("dialog", { name: "Librarian chat" });
  await expect(panel).toBeVisible();
  // above the pill, its right edge on the pill's (once it has grown out)
  await expect
    .poll(async () => {
      const box = (await panel.boundingBox())!;
      return Math.abs(box.x + box.width - (p.x + p.width)) <= 1 && box.y + box.height <= p.y;
    })
    .toBe(true);
  await expect(panel).toContainText("The Librarian only organizes");
  await expect(panel).toContainText("It doesn’t chat.");

  // the pill stays, pressed, and closes it again
  const hide = page.getByRole("button", { name: "Hide the Librarian" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open the Librarian" })).toBeVisible();
});
