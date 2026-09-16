// Rotli Web with an imported vault copy: the chats, their folders, and the
// model each chat was pinned to are the vault's own — the same the Mac app
// shows — read from chats/*.md, .rotli/chat-folders.json, and
// .rotli/settings.json. The snapshot is seeded straight into the browser
// vault, the way "Import a folder" leaves it.

import { expect, test } from "@playwright/test";

const APP = "/app/";
const PORT = 43111;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";

const chatFile = (title: string, updated: string) =>
  `---\nid: ${updated}-${title}\ntitle: ${title}\nsource: rotli\nattachedTo:\nparticipants: [you]\ncreated: ${updated}\nupdated: ${updated}\ntags: [chat]\n---\n\n# ${title}\n\n## Messages\n\n**you** · ${updated}T10:00:00Z — hello\n`;

const SNAPSHOT = {
  version: 1,
  name: "memex-copy",
  dirs: ["wiki", "chats", ".rotli"],
  files: {
    "wiki/hello.md":
      "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\nshelf: [Inbox]\n---\n\n# Hello\n\nA note.\n",
    ".rotli/main.json": JSON.stringify({
      version: 1,
      tree: [{ folder: "Projects", children: [{ note: "01TESTNOTE0000000000000001" }] }],
    }),
    ".rotli/views.json": JSON.stringify({
      version: 1,
      views: [{ name: "OpenSource", tree: [{ note: "01TESTNOTE0000000000000001" }] }],
    }),
    "chats/from-the-app.md": chatFile("From the app", "2026-09-10"),
    "chats/loose-chat.md": chatFile("Loose chat", "2026-09-12"),
    ".rotli/chat-folders.json": JSON.stringify({
      version: 1,
      folders: [{ id: "work", name: "Work" }],
      assignments: { "from-the-app": "work" },
      order: {},
    }),
    ".rotli/settings.json": JSON.stringify({
      onboarded: true,
      theme: "dark",
      themeFamily: "ocean",
      chatModel: { "corpus:from-the-app": "gemma-3-12b-it-qat-4bit", "corpus:loose-chat": "gpt-5.6-sol" },
    }),
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

test("an imported vault shows the app's chats, their folders, and each chat's model", async ({ page }) => {
  await fakeHelper(page);
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.evaluate(
    (snapshot) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("rotli-web");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("vault", "readwrite");
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

  // the vault's own organization and look, exactly as the app keeps them:
  // .rotli/main.json (Main folders), .rotli/views.json (named views),
  // .rotli/settings.json (theme family and mode)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean-dark");
  const mainFolder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Projects" });
  await expect(mainFolder).toBeVisible();
  await page.getByRole("button", { name: "Current view: Main. Change view" }).click();
  await page.getByRole("menuitemcheckbox", { name: "OpenSource" }).click();
  await expect(page.locator(".main-tree")).toHaveAttribute("data-active-view", "OpenSource");
  await expect(page.locator(".main-tree").getByText("Hello", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Current view: OpenSource. Change view" }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Main/ }).click();

  // pair so Chat is a front, then read the sidebar
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator(".sb-switch-seg", { hasText: /^Chat/ }).click();

  const sidebar = page.locator(".sidebar, aside").first();
  // the folder from .rotli/chat-folders.json, with its one chat inside
  await expect(sidebar.getByText("Work", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Loose chat")).toBeVisible();
  // recency comes from the chat's updated: day, never "20712d"
  await expect(sidebar.getByText(/^20\d{3}d$/)).toHaveCount(0);
  // the model each chat was pinned to in the app (.rotli/settings.json):
  // Codex (OpenAI) for the loose chat, Gemma for the one in Work
  const markOf = (slug: string) => page.locator(`.sb-chatrow[data-chat-slug="${slug}"] .sb-chatmark`).first();
  await expect(markOf("loose-chat")).toHaveAttribute("title", /OpenAI/);
  await expect(markOf("from-the-app")).toHaveAttribute("title", /gemma.*this Mac/);
});
