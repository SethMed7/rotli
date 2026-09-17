// Rotli Web: an image dragged onto a chat's sidebar row lights the row, and
// the drop answers in words — the Helper carries text only — instead of the
// browser opening the image over the app (2026-09-17). A note row takes the
// drop into the note; the desktop twin proves that lane in
// e2e/sidebar-drop-targets.spec.ts. Chats come from an imported vault copy.

import { expect, type Locator, test } from "@playwright/test";

const APP = "/app/";
const PORT = 43113;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const chatFile = (title: string, updated: string) =>
  `---\nid: ${updated}-${title}\ntitle: ${title}\nsource: rotli\nattachedTo:\nparticipants: [you]\ncreated: ${updated}\nupdated: ${updated}\ntags: [chat]\n---\n\n# ${title}\n\n## Messages\n\n**you** · ${updated}T10:00:00Z — hello\n`;

const SNAPSHOT = {
  version: 1,
  name: "memex-copy",
  dirs: ["wiki", "chats", ".rotli"],
  files: {
    "wiki/hello.md":
      "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\nshelf: [Inbox]\n---\n\n# Hello\n\nA note.\n",
    ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: "01TESTNOTE0000000000000001" }] }),
    "chats/loose-chat.md": chatFile("Loose chat", "2026-09-12"),
    ".rotli/settings.json": JSON.stringify({ onboarded: true }),
  },
};

function fakeHelper(page: import("@playwright/test").Page) {
  return page.route(`http://127.0.0.1:${PORT}/**`, async (route) => {
    const request = route.request();
    const cors = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (new URL(request.url()).pathname === "/health") {
      return route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({ ok: true, name: "rotli-helper", version: "t" }),
      });
    }
    const body = request.postDataJSON() as { cmd: string };
    const result =
      body.cmd === "cli_detect"
        ? { installed: true, version: "2.1.0", authenticated: true }
        : body.cmd === "chat_models"
          ? []
          : null;
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ result }) });
  });
}

async function dragEvent(target: Locator, type: "dragover" | "drop"): Promise<void> {
  await target.evaluate(
    (host, { base64, type }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      const box = host.getBoundingClientRect();
      host.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: box.left + 10,
          clientY: box.top + box.height / 2,
        }),
      );
    },
    { base64: PNG_BASE64, type },
  );
}

test("an image over a chat row lights the row; the drop says the Helper carries text only", async ({
  page,
}) => {
  await fakeHelper(page);
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.evaluate(
    (snapshot) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("rotli-web");
        open.onsuccess = () => {
          const tx = open.result.transaction("vault", "readwrite");
          tx.objectStore("vault").put(JSON.stringify(snapshot), "vault-import");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    SNAPSHOT,
  );
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");

  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator(".sb-switch-seg", { hasText: /^Chat/ }).click();

  const row = page.locator('.sb-chatrow[data-chat-slug="loose-chat"]').first();
  await expect(row).toBeVisible();
  await dragEvent(row, "dragover");
  await expect(row).toHaveAttribute("data-drop-over", "row");
  await dragEvent(row, "drop");
  await expect(row).not.toHaveAttribute("data-drop-over", /.+/);
  await expect(page.getByText("drop images into a note instead")).toBeVisible();
});
