// Rotli Web + Rotli Helper: the page pairs with a helper on loopback and chat
// runs through it. The helper here is a fake (page.route on 127.0.0.1) so the
// lane proves the whole TypeScript side — pairing, the bridge, the model
// catalogue, a reply — without a real CLI.

import { expect, test } from "@playwright/test";

const APP = "/app/";
const PORT = 43111;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";
const HELPER = `http://127.0.0.1:${PORT}`;

function cors(origin: string | undefined) {
  return {
    "access-control-allow-origin": origin ?? "http://localhost:1437",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

function fakeHelper(page: import("@playwright/test").Page, calls: { cmd: string; args: unknown }[]) {
  return page.route(`${HELPER}/**`, async (route) => {
    const request = route.request();
    const CORS = cors(request.headers()["origin"]);
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    if (url.pathname === "/health") {
      return route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify({ ok: true, name: "rotli-helper", version: "test" }),
      });
    }
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
      return route.fulfill({
        status: 401,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify({ error: "unauthorized" }),
      });
    }
    const body = request.postDataJSON() as { cmd: string; args: unknown };
    calls.push(body);
    const reply = (result: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify({ result }),
      });
    switch (body.cmd) {
      case "chat_models":
        return reply([]);
      case "cli_detect":
        return reply({ installed: true, version: "2.1.0 (Claude Code)", authenticated: true });
      case "cli_complete":
        return reply("Hello from the fake helper.");
      case "cli_cancel":
        return reply(null);
      default:
        return route.fulfill({
          status: 404,
          headers: CORS,
          body: JSON.stringify({ error: "unknown command" }),
        });
    }
  });
}

test("pairing with the helper turns Chat on; a message goes through it and the reply comes back", async ({
  page,
}) => {
  const calls: { cmd: string; args: unknown }[] = [];
  await fakeHelper(page, calls);
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");

  // before pairing: the Chat front opens the walkthrough
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await expect(dialog).toBeVisible();

  // a bad code is refused with words, not a spinner
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill("nonsense");
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not a pairing code");

  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toContainText(`port ${PORT}`);
  // paired, step 3 scans the tools: a ready one reads Connected, no install steps
  await expect(dialog.getByRole("button", { name: /^Claude Code\s*Connected$/ })).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: /^Connected — Claude Code/ })).toBeVisible();
  await expect(dialog.getByText("Install it")).toHaveCount(0);
  // a ready lane is switched on from here, no trip to Settings
  await dialog.getByRole("button", { name: "Use Claude Code in chat" }).click();
  await expect(dialog.getByText(/It is on: pick it/)).toBeVisible();
  await expect(dialog.getByText("An AI tool is connected")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  // the Chat front is a real front now
  await expect(page.locator(".sb-switch-seg.desktop-only")).toHaveCount(0);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const composer = page.getByPlaceholder(/Message rotli/).first();
  await composer.fill("Say hello");
  await composer.press("Enter");
  await expect(page.getByText("Hello from the fake helper.")).toBeVisible({ timeout: 15_000 });
  const complete = calls.find((c) => c.cmd === "cli_complete");
  expect(complete).toBeDefined();
  expect((complete!.args as { provider: string }).provider).toBe("claude");
  // the token never travels anywhere but the helper, and no image rides along
  expect((complete!.args as { images?: unknown }).images).toBeUndefined();
  // the chat's companion note is created through the browser vault, not a
  // memex command the web cannot answer (2026-09-16: "Couldn't create this chat's note")
  await expect(page.getByText(/Couldn.t create this chat.s note/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Open this chat's note|Create this chat's note/ }),
  ).toBeVisible();

  // the pairing survives a reload (browser vault) — the front stays on
  await page.reload();
  await expect(page.locator(".sb-switch-seg.desktop-only")).toHaveCount(0);
});

test("unpairing takes Chat back to the walkthrough", async ({ page }) => {
  const calls: { cmd: string; args: unknown }[] = [];
  await fakeHelper(page, calls);
  await page.goto(APP);
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toBeVisible();
  await dialog.getByRole("button", { name: "Unpair" }).click();
  await expect(dialog.getByRole("button", { name: "Pair" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".sb-switch-seg.desktop-only")).toBeVisible();
});
