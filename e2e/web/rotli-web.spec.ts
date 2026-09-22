// Rotli Web (ROTLI_PLATFORM=web): a vault is required — every note is a file
// in a folder on this computer. Every test gets a fresh browser context, so
// the first visit lands on setup; the origin-private file system stands in
// for a folder the user chose (see ./support.ts).

import { expect, test } from "@playwright/test";

import { APP, readOpfsFile, rememberOpfsVault, startWithVault, vaultGate } from "./support";

test("a first visit is setup: no editor until a vault is connected", async ({ page }) => {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  // no editor, no sidebar, nothing seeded, and no way around it
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText(/Keep notes in this browser/)).toHaveCount(0);
  await expect(page.getByText("Nothing leaves your computer", { exact: false }).first()).toBeVisible();
  // headless Chromium has the live folder API: the browser's own picker, and
  // the note that makes the next visit ask nothing
  await expect(page.getByRole("button", { name: /Choose vault/ })).toBeVisible();
  await expect(page.getByText("Allow on every visit")).toBeVisible();
});

test("an empty folder becomes a vault with the Welcome lessons, as files in the folder", async ({ page }) => {
  await startWithVault(page);
  await expect(page.locator(".main-tree", { hasText: "Welcome" })).toBeVisible();
  // the demo corpus of the desktop twin never seeds here
  await expect(page.getByRole("tab", { name: /notes first/ })).toHaveCount(0);
  // the lesson is a plain Markdown file in the vault, not browser storage
  await expect
    .poll(() => readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md"))
    .toMatch(/^# Welcome to Rotli/);
  await page.reload();
  await expect(vaultGate(page)).toHaveCount(0);
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

test("an edit is saved into the vault's file and is there after a reload", async ({ page }) => {
  await startWithVault(page);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" saved-in-the-vault");
  await expect(editor).toContainText("saved-in-the-vault");
  await expect
    .poll(() => readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md"), { timeout: 10_000 })
    .toContain("saved-in-the-vault");
  await page.reload();
  await expect(page.locator(".cm-content").first()).toContainText("saved-in-the-vault");
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

test("a remembered vault the browser wants to re-ask about is reconnected by name, never replaced", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const proto = FileSystemDirectoryHandle.prototype as unknown as {
      queryPermission: () => Promise<string>;
    };
    proto.queryPermission = async () => "prompt";
  });
  await page.goto(APP);
  await rememberOpfsVault(page);
  await page.reload();
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await expect(page.getByRole("button", { name: /^Reconnect “/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
});

test("a note created in a fresh folder is there after a reload", async ({ page }) => {
  await startWithVault(page);
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
  await startWithVault(page);
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
    dialog.getByText(
      /^curl -fsSL http:\/\/localhost:\d+\/helper\/install\.sh \| sh -s -- --open http:\/\/localhost:\d+\/app\/$/,
    ),
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
  await expect(page.getByText(/every note is a file there/)).toBeVisible();
});

test("the top bar is a toolbar, not window chrome: brand instead of traffic lights, no private browser", async ({
  page,
}) => {
  await startWithVault(page);
  await expect(page.locator("html")).toHaveAttribute("data-platform", "web");
  const brand = page.locator(".titlebar .tb-brand");
  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute("href", "/");
  await expect(page.locator(".titlebar .tb-inset")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New private browser" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Search notes and actions/ })).toBeVisible();
});

test("Rotli Web has one window: Chat cannot be pulled out, and ?window=chat is not a second app", async ({
  page,
}) => {
  // a second browser tab would be a second writer with no coordination
  await startWithVault(page);
  await expect(page.locator(".sb-switch-window")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pull Chat out/ })).toHaveCount(0);

  // the native window's address is just the app here, never a chat-only shell
  await page.goto(`${APP}?window=chat`);
  await expect(page.getByRole("group", { name: "Sidebar front" })).toBeVisible();
  await expect(page.locator(".chat-window")).toHaveCount(0);
});

test("Settings says which vault this browser opens, and offers Change vault and Export", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Rotli Web" })).toBeVisible();
  await expect(page.getByText(/every note is a file there/)).toBeVisible();
  await expect(page.getByText(/Nothing is sent anywhere/)).toBeVisible();
  await page.getByRole("button", { name: "Change vault…" }).click();
  const dialog = page.getByRole("dialog", { name: "Change vault" });
  await expect(dialog).toContainText("Nothing in the vault changes");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Change vault closes it here and returns to setup; the folder keeps its files", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Change vault…" }).click();
  await page
    .getByRole("dialog", { name: "Change vault" })
    .getByRole("button", { name: /Choose another vault/ })
    .click();
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await expect.poll(() => readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md")).toMatch(/^# Welcome/);
});

test("Safari is told plainly it can't connect a vault, with the way forward", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "showDirectoryPicker");
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15",
    });
  });
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Rotli Web needs a computer");
  await expect(page.getByText(/Safari can’t connect one/)).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
});

// The owner, 2026-09-22: a hard refresh must not lose anything. The file write
// can't finish while the page unloads; the typing is journaled synchronously
// and written into the vault on the next boot, before the editor opens.
test("a hard refresh the instant after typing keeps the words, in the vault's file", async ({ page }) => {
  await startWithVault(page);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" typed-then-refreshed");
  await page.reload();
  await expect
    .poll(() => readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md"), { timeout: 10_000 })
    .toContain("typed-then-refreshed");
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

// Adversarial review, round 2: choosing the SAME folder again must keep this
// browser's id for it — the unsaved journal is keyed by that id, and a new
// one would orphan any edit still waiting in it.
test("choosing a folder again keeps its identity — right away, or after another (A → B → A)", async ({
  page,
}) => {
  // the picker hands back the stand-in root ("a") or a folder inside it ("b")
  await page.addInitScript(() => {
    (
      window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return window.sessionStorage.getItem("pick") === "b"
        ? root.getDirectoryHandle("b", { create: true })
        : root;
    };
  });
  await startWithVault(page);
  const folderId = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open("rotli-web");
          open.onsuccess = () => {
            const get = open.result.transaction("vault").objectStore("vault").get("vault-folder-id");
            get.onsuccess = () => resolve(String(get.result ?? ""));
          };
        }),
    );
  const choose = async (pick: "a" | "b") => {
    await page
      .getByRole("button", { name: /Settings/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Change vault…" }).click();
    await page
      .getByRole("dialog", { name: "Change vault" })
      .getByRole("button", { name: /Choose another vault/ })
      .click();
    await expect(vaultGate(page)).toHaveText("Choose your vault");
    await page.evaluate((value) => window.sessionStorage.setItem("pick", value), pick);
    await page.locator(".setup-button.primary", { hasText: "Choose vault…" }).click();
    // a new vault opens on its Welcome note once seeding lands; wait for it,
    // or the seeding's own "close Settings" races the next step
    if (pick === "b")
      await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
    else await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    return folderId();
  };
  const a = await folderId();
  expect(a).not.toBe("");
  expect(await choose("a")).toBe(a);
  const b = await choose("b");
  expect(b).not.toBe(a);
  expect(await choose("a")).toBe(a);
});
