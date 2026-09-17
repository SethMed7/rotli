// Rotli Web: an image dropped on a chat is refused in words — Rotli Helper
// carries text only — and the page stays put (an unhandled file drop would
// make the browser open the image over the app).

import { expect, test } from "@playwright/test";

const APP = "/app/";
const PORT = 43112;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";
const HELPER = `http://127.0.0.1:${PORT}`;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("a file dropped on a web chat says to use a note, and the app stays open", async ({ page }) => {
  await page.route(`${HELPER}/**`, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (new URL(request.url()).pathname === "/health") {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, name: "rotli-helper", version: "t" }),
      });
    }
    const body = request.postDataJSON() as { cmd: string };
    const result =
      body.cmd === "chat_models"
        ? []
        : body.cmd === "cli_detect"
          ? { installed: true, version: "2.1.0", authenticated: true }
          : null;
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ result }) });
  });
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await dialog.getByRole("button", { name: "Use Claude Code in chat" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const composer = page.getByPlaceholder(/Message rotli/).first();
  await expect(composer).toBeVisible();

  const handled = await composer.evaluate((host, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    const box = host.getBoundingClientRect();
    const at = {
      clientX: box.left + 10,
      clientY: box.top + 10,
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
    };
    const over = new DragEvent("dragover", at);
    host.dispatchEvent(over);
    const drop = new DragEvent("drop", at);
    host.dispatchEvent(drop);
    return { over: over.defaultPrevented, drop: drop.defaultPrevented };
  }, PNG_BASE64);
  // the drag was accepted (so the browser never takes the drop) and the drop was answered
  expect(handled).toEqual({ over: true, drop: true });
  await expect(page.getByText(/Files can.t be sent through Rotli Helper yet/)).toBeVisible();
  expect(page.url()).toContain("/app/");
});
