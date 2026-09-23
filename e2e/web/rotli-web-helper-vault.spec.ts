// Rotli Web in a browser without the folder API (Zen, Firefox): the vault is
// a real folder served by Rotli Helper on this computer. The helper here is a
// fake on the page's loopback route, keeping the served folder in memory with
// the real helper's rules (revision gate, empty-folder report); the Rust
// suite (helper_vault_tests.rs) proves the real helper's file handling.
// What this proves is the page: setup can't be skipped, the installer's
// `#pair=` tab pairs the waiting one, notes are written as files in the
// served folder, a reload stays connected, and an outage is waited out —
// never answered with a stand-in vault.

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { APP, vaultGate } from "./support";

const PORT = 43120;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";

interface Served {
  name: string;
  id: string;
}

/** The helper's side, shared by every page of the context. */
function fakeHelperVault() {
  const files = new Map<string, { text: string; mtime: number }>();
  const dirs = new Set<string>();
  let clock = 1_700_000_000_000;
  const state = {
    down: false,
    /** How long /health is held, as a browser holds a request while it asks
     * whether the page may reach apps on this device (Firefox, Zen). */
    healthDelayMs: 0,
    served: null as Served | null,
    chooses: { name: "notes", id: "hv_notes" } as Served,
  };
  const parent = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const mkdirs = (path: string) => {
    for (let dir = path; dir; dir = parent(dir)) dirs.add(dir);
  };
  const stat = (path: string) => {
    const file = files.get(path);
    if (file) return { lastModified: file.mtime, size: Buffer.byteLength(file.text) };
    return dirs.has(path) ? { lastModified: 0, size: 0 } : null;
  };
  const verbs: Record<string, (args: Record<string, unknown>) => unknown> = {
    chat_models: () => [],
    vault_info: () =>
      state.served
        ? { ...state.served, empty: files.size === 0 && [...dirs].every((d) => d === ".rotli") }
        : null,
    vault_choose: () => {
      state.served = state.chooses;
      return verbs.vault_info!({});
    },
    vault_walk: () => [
      ...[...dirs].map((path) => ({ path, kind: "directory", lastModified: 0, size: 0 })),
      ...[...files.keys()].map((path) => ({ path, kind: "file", ...stat(path) })),
    ],
    vault_stat: (a) => stat(String(a.path)),
    vault_read: (a) => {
      const file = files.get(String(a.path));
      if (!file) throw Object.assign(new Error(`no such file: ${String(a.path)}`), { status: 404 });
      return a.encoding === "base64" ? Buffer.from(file.text).toString("base64") : file.text;
    },
    vault_read_many: (a) => ({
      files: Object.fromEntries((a.paths as string[]).map((p) => [p, files.get(p)?.text ?? null])),
      more: [],
    }),
    vault_write: (a) => {
      const path = String(a.path);
      const now = stat(path);
      const current = now && files.has(path) ? `${now.lastModified}:${now.size}` : "0";
      if (typeof a.expectedRevision === "string" && a.expectedRevision !== current) {
        throw Object.assign(new Error("revision conflict: the file changed on disk"), { status: 409 });
      }
      mkdirs(parent(path));
      const text = typeof a.text === "string" ? a.text : Buffer.from(String(a.base64), "base64").toString();
      files.set(path, { text, mtime: (clock += 1000) });
      return stat(path);
    },
    vault_mkdir: (a) => mkdirs(String(a.path)) ?? null,
    vault_move: (a) => {
      const from = files.get(String(a.from));
      if (!from) throw Object.assign(new Error("no such file"), { status: 404 });
      mkdirs(parent(String(a.to)));
      files.set(String(a.to), from);
      files.delete(String(a.from));
      return null;
    },
    vault_remove: (a) => {
      files.delete(String(a.path));
      dirs.delete(String(a.path));
      return null;
    },
  };
  const install = (context: BrowserContext) =>
    context.route(`http://127.0.0.1:${PORT}/**`, async (route) => {
      const request = route.request();
      const cors = {
        "access-control-allow-origin": request.headers()["origin"] ?? "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "content-type": "application/json",
      };
      if (state.down) return route.abort("connectionrefused");
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (new URL(request.url()).pathname === "/health") {
        if (state.healthDelayMs) await new Promise((resolve) => setTimeout(resolve, state.healthDelayMs));
        const health = { ok: true, name: "rotli-helper", version: "1.3.0" };
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(health) });
      }
      if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
        return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: "unauthorized" }) });
      }
      const { cmd, args } = request.postDataJSON() as { cmd: string; args: Record<string, unknown> };
      const verb = verbs[cmd];
      if (!verb)
        return route.fulfill({
          status: 404,
          headers: cors,
          body: JSON.stringify({ error: "unknown command" }),
        });
      try {
        return await route.fulfill({
          status: 200,
          headers: cors,
          body: JSON.stringify({ result: verb(args ?? {}) ?? null }),
        });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return route.fulfill({
          status,
          headers: cors,
          body: JSON.stringify({ error: (error as Error).message }),
        });
      }
    });
  return { files, state, install };
}

/** A browser without the File System Access API, like Zen or Firefox. */
async function withoutFolderApi(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "showDirectoryPicker");
  });
}

/** Setup end to end: paste the code, choose the folder, land on Welcome. */
async function connectThroughHelper(page: Page): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Set up Rotli Helper");
  await page.getByLabel("Or paste the pairing code the installer printed:").fill(`${PORT}:${TOKEN}`);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(vaultGate(page)).toHaveText("Rotli Helper is paired");
  await page.locator(".setup-button.primary", { hasText: "Continue" }).click();
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await page.locator(".setup-button.primary", { hasText: "Choose folder…" }).click();
  // a reload plus Welcome seeding: allow a loaded runner its time
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli", {
    timeout: 15_000,
  });
}

test("the installer's #pair= tab offers the code, Pair shows success, and the waiting setup moves on", async ({
  context,
  page,
}) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Set up Rotli Helper");
  // no way around setup, and the install line opens this page with the code
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.locator(".guide-cmd code").first()).toContainText("install.sh | sh -s -- --open");

  // the installer's tab: the token leaves the address bar at once, and waits
  // in the Pair field for the person to press Pair
  const installerTab = await context.newPage();
  await installerTab.goto(`${APP}#pair=${PORT}:${TOKEN}`);
  await expect(installerTab).toHaveURL((url) => !url.hash.includes(TOKEN));
  await expect(installerTab.getByLabel("Pairing code:")).toHaveValue(`${PORT}:${TOKEN}`);
  expect(helper.state.served).toBeNull();
  await installerTab.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(vaultGate(installerTab)).toHaveText("Rotli Helper is paired");
  await expect(installerTab.getByText(/never to the internet/)).toBeVisible();
  await installerTab.locator(".setup-button.primary", { hasText: "Continue" }).click();
  await expect(vaultGate(installerTab)).toHaveText("Choose your vault", { timeout: 10_000 });
  // the person closes the extra tab (left open, it would connect too and race
  // this one to set up the new vault — harmless, but then either may open it)
  await installerTab.close();

  // the waiting tab moves on by itself, then the helper's picker chooses
  await expect(vaultGate(page)).toHaveText("Choose your vault", { timeout: 10_000 });
  await page.locator(".setup-button.primary", { hasText: "Choose folder…" }).click();
  // a reload plus Welcome seeding: allow a loaded runner its time
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli", {
    timeout: 15_000,
  });
  // the lessons are files in the served folder, and the spine the Mac app reads
  expect(helper.files.get("wiki/Welcome/Welcome to Rotli.md")?.text).toMatch(/^# Welcome to Rotli/);
  expect(helper.files.has("memex.json")).toBe(true);

  await page.reload();
  await expect(vaultGate(page)).toHaveCount(0);
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

test("Pair waits while the browser asks about reaching this device, then pairs", async ({
  context,
  page,
}) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  // longer than a background probe waits (2.5 s): the person is reading the prompt
  helper.state.healthDelayMs = 4_000;
  await page.goto(`${APP}#pair=${PORT}:${TOKEN}`);
  await page.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(page.getByText(/may connect to apps on this device, choose Allow/)).toBeVisible();
  await expect(vaultGate(page)).toHaveText("Rotli Helper is paired", { timeout: 10_000 });
});

test("an edit is written into the served folder, and survives a reload", async ({ context, page }) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await connectThroughHelper(page);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" saved-through-the-helper");
  await expect
    .poll(() => helper.files.get("wiki/Welcome/Welcome to Rotli.md")?.text ?? "", { timeout: 10_000 })
    .toContain("saved-through-the-helper");
  await page.reload();
  await expect(page.locator(".cm-content").first()).toContainText("saved-through-the-helper");
});

test("a new note is created as a file in the served folder", async ({ context, page }) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await connectThroughHelper(page);
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.keyboard.type("# Made through the helper");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Made through the helper");
  await expect(page.locator(".row-action-error")).toHaveCount(0);
  await expect
    .poll(
      () =>
        [...helper.files.entries()].find(
          ([path, file]) =>
            path.startsWith("wiki/_inbox/") && file.text.includes("# Made through the helper"),
        )?.[0] ?? "",
      { timeout: 10_000 },
    )
    .toMatch(/^wiki\/_inbox\/.+\.md$/);
});

test("a helper that stops answering is waited out: the edit lands when it's back", async ({
  context,
  page,
}) => {
  test.slow(); // real debounce + retry timers; a loaded runner stretches them
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await connectThroughHelper(page);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  // the helper goes away between the keystrokes and their save (the editor
  // waits a beat before saving): the SAVE meets the outage. Taking it down
  // first raced background calls on a slow runner — the cover then (rightly)
  // blocked the click before any typing happened
  await page.keyboard.type(" typed-while-offline", { delay: 0 });
  helper.state.down = true;
  await expect(page.getByRole("alertdialog", { name: /Reconnecting to “notes”/ })).toBeVisible({
    timeout: 10_000,
  });
  expect(helper.files.get("wiki/Welcome/Welcome to Rotli.md")?.text ?? "").not.toContain(
    "typed-while-offline",
  );
  // the cover really covers: it holds focus, and the editor can't be clicked
  await expect(page.locator(".web-vault-reconnecting")).toHaveCSS("position", "fixed");
  await expect(page.locator(".web-vault-reconnecting-card")).toBeFocused();
  await expect(editor.click({ timeout: 1_000 })).rejects.toThrow();
  helper.state.down = false;
  await expect(page.getByRole("alertdialog", { name: /Reconnecting/ })).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(() => helper.files.get("wiki/Welcome/Welcome to Rotli.md")?.text ?? "", { timeout: 10_000 })
    .toContain("typed-while-offline");
});

test("a helper that isn't running at boot is named on the setup screen, and no editor opens", async ({
  context,
  page,
}) => {
  test.slow(); // real debounce + retry timers; a loaded runner stretches them
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await connectThroughHelper(page);
  helper.state.down = true;
  await page.reload();
  await expect(vaultGate(page)).toHaveText("Set up Rotli Helper");
  await expect(page.getByText(/Rotli Helper isn’t answering, so “notes” can’t open/)).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  // it comes back: setup notices and opens the same vault, on its freshest note
  helper.state.down = false;
  await expect(vaultGate(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});

test("a helper now serving a different folder asks which vault, instead of writing into it", async ({
  context,
  page,
}) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await withoutFolderApi(context);
  await connectThroughHelper(page);
  helper.state.served = { name: "other", id: "hv_other" };
  await page.reload();
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await expect(
    page.getByText(/This browser opened “notes”, but Rotli Helper now serves a different folder/),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
});
