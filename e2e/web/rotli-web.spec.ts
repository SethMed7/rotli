// Rotli Web (ROTLI_PLATFORM=web): the browser is the vault. Every test gets a
// fresh browser context, so IndexedDB starts empty — a first visit.

import { expect, test } from "@playwright/test";

const APP = "/app/";

test("a first visit seeds the Welcome folder and opens the welcome note", async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(page.locator(".main-tree", { hasText: "Welcome" })).toBeVisible();
  // the demo corpus of the desktop twin never seeds here
  await expect(page.getByRole("tab", { name: /notes first/ })).toHaveCount(0);
});

test("an edit, the open tab, and Main survive a reload", async ({ page }) => {
  await page.goto(APP);
  const editor = page.locator(".cm-content").first();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" persisted-in-this-browser");
  await expect(editor).toContainText("persisted-in-this-browser");
  // the real signal: the vault (IndexedDB) holds the edit — the editor's
  // autosave and the vault writer are both debounced
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open("rotli-web");
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains("vault")) return resolve(false);
                const get = db.transaction("vault").objectStore("vault").get("notes");
                get.onsuccess = () => resolve(String(get.result ?? "").includes("persisted-in-this-browser"));
                get.onerror = () => resolve(false);
              };
              open.onerror = () => resolve(false);
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(page.locator(".cm-content").first()).toContainText("persisted-in-this-browser");
  // the Welcome folder was not re-seeded over the edit: still one welcome note
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

test("a note created in a fresh folder is there after a reload", async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Kept");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  await expect(page.locator('.main-tree [data-main-folder="1"]', { hasText: "Kept" })).toBeVisible();

  await page.reload();
  await expect(page.locator('.main-tree [data-main-folder="1"]', { hasText: "Kept" })).toBeVisible();
});

test("the web build keeps Chat visible; clicking it walks through the helper and the tool sign-in", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  const chatFront = page.locator(".sb-switch-seg.desktop-only");
  await expect(chatFront).toBeVisible();
  await expect(chatFront).toHaveAttribute("title", /click to see how/i);
  await chatFront.click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await expect(dialog).toBeVisible();
  // step 1 leads with the helper on every OS, honest that it is built from
  // source today; step 2 is the live pairing form
  await expect(dialog.getByText("Install and start Rotli Helper")).toBeVisible();
  await expect(
    dialog.getByText(/^curl -fsSL http:\/\/localhost:\d+\/helper\/install\.sh \| sh$/),
  ).toBeVisible();
  await expect(dialog.getByText("~/.rotli/bin/rotli-helper")).toBeVisible();
  await expect(dialog.getByLabel("Paste the pairing code the helper printed:")).toBeVisible();
  // step 3 the user can do now: the real install + sign-in commands, copyable
  await expect(dialog.getByText("npm install -g @anthropic-ai/claude-code")).toBeVisible();
  await expect(dialog.getByText("claude auth login")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Copy: claude auth login/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(dialog.getByText("codex login")).toBeVisible();
  // the web cannot look at the user's machine: no Check again
  await expect(dialog.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // the note's chat chip opens the same walkthrough
  const chip = page.getByRole("button", { name: "Chats on this note" });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", /click to see how/);
  await chip.click();
  await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
  await page.getByRole("dialog", { name: "Chat on the web" }).getByRole("button", { name: "Close" }).click();

  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Rotli Web" })).toBeVisible();
  await expect(page.getByText(/Your vault lives in this browser/)).toBeVisible();
});

test("the top bar is a toolbar, not window chrome: brand instead of traffic lights, no private browser", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(page.locator("html")).toHaveAttribute("data-platform", "web");
  const brand = page.locator(".titlebar .tb-brand");
  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute("href", "/");
  await expect(page.locator(".titlebar .tb-inset")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New private browser" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Search notes and actions/ })).toBeVisible();
});

test("Settings → General offers a real folder (Chromium) and says where the notes live", async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Rotli Web" })).toBeVisible();
  await expect(page.getByText(/Your vault lives in this browser/)).toBeVisible();
  // headless Chromium has the picker, so the folder action is offered
  await expect(page.getByRole("button", { name: "Connect a vault on this computer…" })).toBeVisible();
});

test("connecting a folder explains itself before the browser's picker, and can be cancelled", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Connect a vault on this computer…" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a vault" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nothing leaves your computer");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("the Files button is in the footer on the web and opens the Library", async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const files = page.locator(".sb-foot").getByRole("button", { name: "Files" });
  await expect(files).toBeVisible();
  await files.click();
  await expect(page.locator(".system-browser")).toBeVisible();
});
