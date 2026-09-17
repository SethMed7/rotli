// Rotli Web, folder mode, driven without the directory picker: the
// origin-private file system hands out the same FileSystemDirectoryHandle the
// picker does, so a planted folder stands in for one the user chose. Two
// truths: the chat rows show each chat's own model from the folder's
// settings.json (the file the Mac app writes), and a folder waiting on the
// browser's permission is said out loud in the sidebar with a Reconnect.

import { expect, type Page, test } from "@playwright/test";

const APP = "/app/";
const PORT = 43115;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";

const chatFile = (title: string, updated: string) =>
  `---\nid: ${updated}-${title}\ntitle: ${title}\nsource: rotli\nattachedTo:\nparticipants: [you]\ncreated: ${updated}\nupdated: ${updated}\ntags: [chat]\n---\n\n# ${title}\n\n## Messages\n\n**you** · ${updated}T10:00:00Z — hello\n`;

const FOLDER: Record<string, string> = {
  "wiki/hello.md":
    "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\nshelf: [Inbox]\n---\n\n# Hello\n\nA note.\n",
  ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: "01TESTNOTE0000000000000001" }] }),
  "chats/gemma-chat.md": chatFile("Gemma chat", "2026-09-12"),
  "chats/gemini-chat.md": chatFile("Gemini chat", "2026-09-13"),
  "chats/label-chat.md": chatFile("Label chat", "2026-09-14"),
  "chats/sonnet-chat.md": chatFile("Sonnet chat", "2026-09-15"),
  ".rotli/settings.json": JSON.stringify({
    onboarded: true,
    chatModelId: "sonnet",
    chatModel: {
      "corpus:gemma-chat": "gemma-3-12b-it-qat-4bit",
      "corpus:gemini-chat": "gemini-3.7-flash-high",
      // the old picker stored its label; the Mac app still shows Google's mark
      "corpus:label-chat": "Gemini 3.5 Flash (Medium)",
      "corpus:sonnet-chat": "sonnet",
    },
  }),
};

function fakeHelper(page: Page) {
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

/** Write the folder into the origin-private file system and remember its
 * handle the way "Open a folder on this computer" does. */
async function plantFolder(page: Page): Promise<void> {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const file = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
    }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("rotli-web");
      open.onsuccess = () => {
        const tx = open.result.transaction("vault", "readwrite");
        tx.objectStore("vault").put(root, "vault-handle");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, FOLDER);
}

async function pairAndOpenChat(page: Page): Promise<void> {
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator(".sb-switch-seg", { hasText: /^Chat/ }).click();
}

test("a connected folder's chats show each chat's own model from the folder's settings", async ({ page }) => {
  await fakeHelper(page);
  await plantFolder(page);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  await expect(page.locator(".sb-reconnect")).toHaveCount(0);
  await pairAndOpenChat(page);

  const markOf = (slug: string) => page.locator(`.sb-chatrow[data-chat-slug="${slug}"] .sb-chatmark`).first();
  await expect(markOf("sonnet-chat")).toHaveClass(/anthropic/);
  await expect(markOf("gemini-chat")).toHaveClass(/gemini/);
  await expect(markOf("gemma-chat")).toHaveClass(/gemma/);
  await expect(markOf("label-chat")).toHaveClass(/gemini/);
  await expect(markOf("label-chat")).toHaveAttribute("title", /Google/);
});

test("a folder waiting on the browser's permission is said in the sidebar, with Reconnect", async ({
  page,
}) => {
  await fakeHelper(page);
  await plantFolder(page);
  // the next visit: Chromium remembers the folder but asks again
  await page.addInitScript(() => {
    const proto = FileSystemDirectoryHandle.prototype as unknown as {
      queryPermission: () => Promise<string>;
    };
    proto.queryPermission = async () => "prompt";
  });
  await page.reload();
  await page.getByRole("tablist").waitFor();
  const bar = page.locator(".sb-reconnect");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("needs permission again");
  await expect(bar.getByRole("button", { name: "Reconnect" })).toBeVisible();
});
