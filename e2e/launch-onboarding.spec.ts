import { expect, test, type Page } from "@playwright/test";

import { cycleEveryTheme, themeNow } from "./support";

// Fresh-vault onboarding (development-only `?onboarding` route, empty in-memory
// corpus). Every new vault gets a Welcome folder in Main: the welcome note and
// three lessons as ordinary notes, opened from the left menu, edited in the
// ordinary editor ("a preseeded folder, that's it — it uses the left menu").

const welcomeFolder = (page: Page) =>
  page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
const LESSON_ROW = /^(Welcome to Rotli|Writing|Organizing and finding|AI and privacy)$/;
const lessonRows = (page: Page) =>
  page.locator(".main-tree button[data-main-id][data-note-id]", { hasText: LESSON_ROW });
const rawToggle = async (page: Page, mode: "Raw markdown" | "Beautified") => {
  await page.getByRole("button", { name: "Aa", exact: true }).click();
  await page.getByRole("dialog", { name: "Typography" }).getByRole("button", { name: mode }).click();
  await page.keyboard.press("Escape");
};

async function onboard(page: Page) {
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Launch Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  // the Librarian has its own screen; with no signed-in client in the twin it
  // offers only this Mac, already pressed
  await expect(page.getByText("3 of 4")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Librarian model" }).getByRole("button", { name: "On this Mac" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Three shortcuts, yours to change." })).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page
    .getByRole("dialog", { name: "Thank you for trying Rotli" })
    .getByRole("button", { name: "Take the tour" })
    .click();
  await page.getByRole("button", { name: "Skip tour" }).click();
  // skipping the tour points at Settings for the rest
  await page
    .getByRole("status", { name: "More in Settings" })
    .getByRole("button", { name: "Got it" })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const folder = welcomeFolder(page);
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await expect(lessonRows(page)).toHaveCount(4);
}

/** Left offset (px) of every list control and the H1's text from the editor's
 * text edge. The H1 is "the most left you can go"; nothing may sit past it. */
async function gutterOffsets(page: Page) {
  return page
    .locator(".cm-content")
    .last()
    .evaluate((content) => {
      const edge = content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft);
      const h1 = content.querySelector(".cm-line.rotli-h1");
      const range = document.createRange();
      if (h1) range.selectNodeContents(h1);
      const rows = Array.from(
        // a multi-choice question renders as a panel (placed left, center, or
        // right), not a list row, so it isn't held to the H1 edge
        content.querySelectorAll(
          ".rotli-check, .rotli-result, .rotli-marker, .rotli-choice:not(.rotli-choice--multi), .rotli-toggle",
        ),
      ).map((el) => ({ control: el.className.toString(), left: el.getBoundingClientRect().left - edge }));
      return { h1: h1 ? range.getBoundingClientRect().left - edge : null, rows };
    });
}

test("first-time setup opens in Rotli Light with a plain quokka, and a choice survives the vault round trip", async ({
  page,
}) => {
  await page.goto("/?onboarding");
  await expect(page.getByRole("heading", { name: "Make Rotli yours." })).toBeVisible();
  await expect(page.getByText("1 of 4")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const companion = page.locator(".setup-companion .quokka");
  await expect(companion).toBeVisible();
  await expect(companion.locator(".quokka-accessory-layer")).toHaveCount(0);
  // the quokka's wardrobe waits in Settings (the owner, 2026-10-01)
  await expect(page.getByRole("checkbox", { name: "Keep my quokka throughout Rotli" })).toHaveCount(0);
  await expect(
    page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: /Rotli/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page
      .getByRole("radiogroup", { name: "Appearance mode" })
      .getByRole("radio", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-checked", "true");

  // a choice made in setup survives the round trip through the vault step
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: /Midnight/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "Appearance mode" })
    .getByRole("radio", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight-dark");
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await expect(page.getByText("2 of 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose an empty folder" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Choose where notes live" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight-dark");
});

test("after setup the music player is already there, quiet, and can be put away", async ({ page }) => {
  await onboard(page);
  const player = page.getByRole("region", { name: "Now playing" });
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Hide the player" }).click();
  await expect(player).toHaveCount(0);
});

test("skipping the tour points at Settings, and the note opens it", async ({ page }) => {
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Hint Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page
    .getByRole("dialog", { name: "Thank you for trying Rotli" })
    .getByRole("button", { name: "Take the tour" })
    .click();
  const note = page.getByRole("status", { name: "More in Settings" });
  // the tour first; the note waits for it
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(note).toBeVisible();
  await expect(note).toContainText("Your quokka, music, how the window lives, chat models");
  // it sits beside Settings, inside the window
  await expect(note).toBeInViewport({ ratio: 1 });
  await note.getByRole("button", { name: "Open Settings" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to notes", exact: true })).toBeVisible();
});

test("the Librarian screen asks whether first; Not now hides where it thinks and leaves it off", async ({
  page,
}) => {
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Raw Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  // the vault step no longer asks; the Librarian screen does
  await expect(page.getByRole("radiogroup", { name: "Librarian choice" })).toHaveCount(0);
  const choice = page.getByRole("radiogroup", { name: "Librarian", exact: true });
  await expect(choice.getByRole("radio", { name: /^Use the Librarian/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const where = page.getByRole("group", { name: "Librarian model" });
  await expect(where).toBeVisible();
  await choice.getByRole("radio", { name: /^Not now/ }).click();
  await expect(where).toHaveCount(0);
  await choice.getByRole("radio", { name: /^Use the Librarian/ }).click();
  await expect(where).toBeVisible();
  await choice.getByRole("radio", { name: /^Not now/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page
    .getByRole("dialog", { name: "Thank you for trying Rotli" })
    .getByRole("button", { name: "Take the tour" })
    .click();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page
    .getByRole("status", { name: "More in Settings" })
    .getByRole("button", { name: "Open Settings" })
    .click();
  await page.getByRole("button", { name: "Librarian", exact: true }).click();
  await expect(page.getByRole("switch", { name: /This is a raw vault/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("the shortcuts screen says each can change, and a changed one can go back", async ({ page }) => {
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Keys Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("4 of 4")).toBeVisible();
  await expect(page.getByText(/change them anytime in Settings → Hotkeys/)).toBeVisible();
  const capture = page.getByRole("button", { name: "Change Quick capture shortcut" });
  await expect(capture).toContainText("Change");
  await capture.click();
  await expect(page.getByRole("button", { name: "Press the new Quick capture shortcut" })).toContainText(
    "Esc cancels",
  );
  // Esc cancels: the shortcut stays as it was
  await page.keyboard.press("Escape");
  await expect(capture).toContainText("⌥C");
  await capture.click();
  await page.keyboard.press("Alt+Shift+KeyK");
  await expect(capture).toContainText("⌥⇧K");
  await page.getByRole("button", { name: "Use default" }).click();
  await expect(capture).toContainText("⌥C");
  await expect(page.getByRole("button", { name: "Use default" })).toHaveCount(0);
});

test("the guided tour follows setup, spotlights real controls, skips missing ones, and reopens from Settings", async ({
  page,
}) => {
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Tour Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Create vault here", exact: true }).click();
  // the Librarian, then the shortcuts, then the thank-you card
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page
    .getByRole("dialog", { name: "Thank you for trying Rotli" })
    .getByRole("button", { name: "Take the tour" })
    .click();
  const tour = page.getByRole("region", { name: "Guided tour" });
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute("data-step", "new");
  await expect(tour).toContainText("1 of");
  const ringOver = async (name: RegExp | string) => {
    const ring = (await tour.locator(".tour-ring").boundingBox())!;
    const target = (await page.getByRole("button", { name }).first().boundingBox())!;
    expect(ring.x).toBeLessThanOrEqual(target.x);
    expect(ring.y).toBeLessThanOrEqual(target.y);
    expect(ring.x + ring.width).toBeGreaterThanOrEqual(target.x + target.width);
    expect(ring.y + ring.height).toBeGreaterThanOrEqual(target.y + target.height);
  };
  await ringOver(/^New note in /);
  // one scrim, and the dimmed app still takes real clicks (the old panels
  // intercepted them — and native Finder drops with them)
  await expect(tour.locator(".tour-scrim")).toHaveCount(1);
  await page.getByRole("tab", { selected: true }).click();
  await expect(tour).toHaveAttribute("data-step", "new");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toHaveAttribute("data-step", "views");
  await ringOver(/^Current view: /);
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour).toHaveAttribute("data-step", "new");
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  // the app underneath was live the whole time
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Show me around" }).click();
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute("data-step", "new");
  for (let index = 0; index < 6; index++) {
    const done = tour.getByRole("button", { name: "Done" });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour).toBeHidden();
});

test("fresh onboarding seeds a Welcome folder in Main and opens the welcome note", async ({ page }) => {
  await onboard(page);
  const rows = lessonRows(page);
  await expect(rows.first()).toHaveText("Welcome to Rotli");
  await expect(rows.nth(1)).toHaveText("Writing");
  await expect(rows.last()).toHaveText("AI and privacy");
  await expect(page.locator(".cm-content")).toContainText("Guided lessons");

  // the left menu opens a lesson like any other note
  await rows.nth(1).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Writing");
  // the tasks sit below the fold in Writing: scroll to them first
  const task = page.locator(".rotli-task").first();
  await task.scrollIntoViewIfNeeded();
  // the note may still settle its scroll, which hides the handle: hover again
  // until it shows
  await expect(async () => {
    await page.mouse.move(0, 0);
    await task.hover();
    await expect(page.locator(".cm-block-handle.on")).toBeVisible({ timeout: 500 });
  }).toPass();
  const handle = await page.locator(".cm-block-handle.on").boundingBox();
  const checkbox = page.getByRole("checkbox", { name: "Not started", exact: true });
  const box = await checkbox.boundingBox();
  expect(handle).not.toBeNull();
  expect(box).not.toBeNull();
  expect(handle!.x + handle!.width).toBeLessThanOrEqual(box!.x);

  // ticking edits the lesson file itself; Aa → Raw markdown shows the state character
  await checkbox.click();
  await rawToggle(page, "Raw markdown");
  await expect(page.locator(".cm-content")).toContainText("- [x] Write the first draft");
  await rawToggle(page, "Beautified");
  // the lesson ships one done task; the tick adds a second
  await expect(page.getByRole("checkbox", { name: "Done", exact: true })).toHaveCount(2);
  await expect(rows).toHaveCount(4);

  // Settings → Open welcome folder is idempotent and lands on the welcome note again
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(welcomeFolder(page)).toHaveCount(1);
  await expect(rows).toHaveCount(4);
});

test("every Welcome note opens from Main as an ordinary note and the practice-vault option is gone", async ({
  page,
}) => {
  // four note opens re-render the Main tree each time; the hosted runner needs
  // the slow budget, and the taller viewport keeps every row inside the sidebar
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await expect(page.getByRole("radio", { name: /practice vault/i })).toHaveCount(0);
  await expect(page.getByText(/practice vault/i)).toHaveCount(0);
  await onboard(page);
  const rows = lessonRows(page);
  for (let index = 0; index < 4; index++) {
    const title = (await rows.nth(index).textContent())!.trim();
    await rows.nth(index).scrollIntoViewIfNeeded();
    await rows.nth(index).click();
    await expect(page.getByRole("tab", { selected: true })).toContainText(title);
    await expect(page.locator(".cm-content").last()).toContainText(title);
  }
  await expect(page.getByRole("combobox", { name: "Lesson" })).toHaveCount(0);
});

test("checkboxes and list markers align with the H1 in every environment and a narrow window", async ({
  page,
}, testInfo) => {
  // fourteen environment switches with a geometry probe and two screenshots
  // each outgrow the default budget on the hosted runner
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page);
  await cycleEveryTheme(page);
  await lessonRows(page).nth(1).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Writing");
  const theme = page.getByRole("button", { name: /^Theme —/ });
  const environments = new Set<string>();
  const assertAligned = async (label: string) => {
    const { h1, rows } = await gutterOffsets(page);
    expect(h1, label).not.toBeNull();
    expect(Math.abs(h1!), label).toBeLessThan(1);
    expect(rows.length, label).toBeGreaterThan(3);
    for (const row of rows) {
      // the box or marker starts on the H1 edge, never in the margin
      expect(row.left, `${label}: ${row.control}`).toBeGreaterThanOrEqual(-0.5);
      expect(row.left, `${label}: ${row.control}`).toBeLessThan(1);
    }
  };
  for (let index = 0; index < 14; index++) {
    const label = themeNow(await theme.getAttribute("aria-label"));
    environments.add(label);
    await assertAligned(label);
    if (label === "Ocean Light" || label === "Ocean Dark") {
      await page.screenshot({
        path: testInfo.outputPath(label.endsWith("Light") ? "playground-light.png" : "playground-dark.png"),
      });
    }
    await theme.click();
  }
  expect(environments.size).toBe(14);
  await page.setViewportSize({ width: 760, height: 740 });
  await assertAligned("narrow");
  await expect(page.getByRole("checkbox", { name: "Not started", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("playground-narrow.png") });
});
