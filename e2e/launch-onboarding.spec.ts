import { expect, test, type Page } from "@playwright/test";

// Fresh-vault onboarding (development-only `?onboarding` route, empty in-memory
// corpus). Every new vault gets a Welcome folder in Main: the welcome note and
// nine lessons as ordinary notes, opened from the left menu, edited in the
// ordinary editor ("a preseeded folder, that's it — it uses the left menu").

const welcomeFolder = (page: Page) =>
  page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
const LESSON_ROW =
  /^(Welcome to Rotli|Writing and formatting|Tasks and progress|Choices and toggles|Tables and code|Links and finding|Main and named views|Files and attachments|AI and privacy|Your launch checklist)$/;
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
  await page.getByRole("button", { name: "Use empty folder", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Launch Practice?" })).toBeVisible();
  await page.getByRole("button", { name: /^Create vault/ }).click();
  await page.getByRole("button", { name: "Skip model setup" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const folder = welcomeFolder(page);
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await expect(lessonRows(page)).toHaveCount(10);
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
        content.querySelectorAll(".rotli-check, .rotli-result, .rotli-marker, .rotli-choice, .rotli-toggle"),
      ).map((el) => ({ control: el.className.toString(), left: el.getBoundingClientRect().left - edge }));
      return { h1: h1 ? range.getBoundingClientRect().left - edge : null, rows };
    });
}

test("fresh onboarding seeds a Welcome folder in Main and opens the welcome note", async ({ page }) => {
  await onboard(page);
  const rows = lessonRows(page);
  await expect(rows.first()).toHaveText("Welcome to Rotli");
  await expect(rows.nth(2)).toHaveText("Tasks and progress");
  await expect(rows.last()).toHaveText("Your launch checklist");
  await expect(page.locator(".cm-content")).toContainText("Guided lessons");

  // the left menu opens a lesson like any other note
  await rows.nth(2).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Tasks and progress");
  await page.locator(".rotli-task").first().hover();
  await expect(page.locator(".cm-block-handle.on")).toBeVisible();
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
  await expect(rows).toHaveCount(10);

  // Settings → Open welcome folder is idempotent and lands on the welcome note again
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(welcomeFolder(page)).toHaveCount(1);
  await expect(rows).toHaveCount(10);
});

test("every Welcome note opens from Main as an ordinary note and the practice-vault option is gone", async ({
  page,
}) => {
  // ten note opens re-render the Main tree each time; the hosted runner needs
  // the slow budget, and the taller viewport keeps every row inside the sidebar
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?onboarding");
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await expect(page.getByRole("radio", { name: /practice vault/i })).toHaveCount(0);
  await expect(page.getByText(/practice vault/i)).toHaveCount(0);
  await onboard(page);
  const rows = lessonRows(page);
  for (let index = 0; index < 10; index++) {
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
  // twelve environment switches with a geometry probe and two screenshots
  // each outgrow the default budget on the hosted runner
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page);
  await lessonRows(page).nth(2).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Tasks and progress");
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
  for (let index = 0; index < 12; index++) {
    const label = (await theme.getAttribute("aria-label"))!;
    environments.add(label);
    await assertAligned(label);
    if (label === "Theme — Ocean Light" || label === "Theme — Ocean Dark") {
      await page.screenshot({
        path: testInfo.outputPath(label.endsWith("Light") ? "playground-light.png" : "playground-dark.png"),
      });
    }
    await theme.click();
  }
  expect(environments.size).toBe(12);
  await page.setViewportSize({ width: 760, height: 740 });
  await assertAligned("narrow");
  await expect(page.getByRole("checkbox", { name: "Not started", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("playground-narrow.png") });
});
