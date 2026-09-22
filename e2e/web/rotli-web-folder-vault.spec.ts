// Rotli Web, folder mode, driven without the directory picker: the
// origin-private file system hands out the same FileSystemDirectoryHandle the
// picker does, so a planted folder stands in for one the user chose. Two
// truths: the chat rows show each chat's own model from the folder's
// settings.json (the file the Mac app writes), and a folder waiting on the
// browser's permission is reconnected by name before any editor shows.

import { expect, type Page, test } from "@playwright/test";

import { APP, vaultGate } from "./support";

const PORT = 43115;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";

// a saved layout in the Templates folder — carrying a shelf on purpose: the
// shelf projects it elsewhere, and `/template` must still find it by its folder
const TEMPLATE: Record<string, string> = {
  "wiki/Templates/standup.md":
    "---\nid: 01TESTTEMPLATE00000000001\ntitle: Standup\nshelf: [Inbox]\n---\n\n# Standup\n\n## Yesterday\n\n## Today\n",
};

const chatFile = (title: string, updated: string) =>
  `---\nid: ${updated}-${title}\ntitle: ${title}\nsource: rotli\nattachedTo:\nparticipants: [you]\ncreated: ${updated}\nupdated: ${updated}\ntags: [chat]\n---\n\n# ${title}\n\n## Messages\n\n**you** · ${updated}T10:00:00Z — hello\n`;

const FOLDER: Record<string, string> = {
  "wiki/projects/hello.md":
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
 * handle the way "Connect a vault on this computer" does. */
async function plantFolder(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toBeVisible();
  await plantFolderFiles(page, extra);
}

/** The planting alone, on whatever page is open. */
async function plantFolderFiles(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.evaluate(
    async (files) => {
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
    },
    { ...FOLDER, ...extra },
  );
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

test("Files hands the note you're in to the Mac app, which opens Finder at it", async ({ page }) => {
  await fakeHelper(page);
  await plantFolder(page);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  await page.locator(".sb-foot").getByRole("button", { name: "Files" }).click();
  // the page cannot open Finder; it hands the FILE to the installed app by
  // its rotli:// scheme (no handler in this browser — the link is the proof)
  await expect(page.locator("html")).toHaveAttribute(
    "data-rotli-deep-link",
    /^rotli:\/\/reveal\?id=wiki%2Fprojects%2Fhello\.md/,
  );
  await expect(page.getByText("Asked the Rotli app to show it in Finder")).toBeVisible();
  // and it did not wander into the Library instead
  await expect(page.locator(".system-browser")).toHaveCount(0);
});

test("/template inserts a layout from the connected folder's Templates folder", async ({ page }) => {
  await fakeHelper(page);
  await plantFolder(page, TEMPLATE);
  await page.reload();
  await page.locator(".main-tree .main-row", { hasText: "Hello" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");

  const editor = page.locator(".pane.focused .cm-content");
  // the caret to the end of the note's last line, portably
  await editor.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("\n\n/template");
  await page
    .getByRole("menu", { name: "Insert block" })
    .getByRole("menuitem", { name: /Template/ })
    .click();
  // the folder's own template first, then the built-in presets, then Create new
  const labels = page.getByRole("menu", { name: "Template" }).locator(".slashlabel");
  await expect(labels.first()).toHaveText("Standup");
  await expect(labels).toContainText(["Daily note", "Create new"]);
  await page.keyboard.press("Enter");

  // the note already has content, so it keeps its own title: the template's
  // heading stays behind and only its sections arrive
  await expect(editor).toContainText("Yesterday");
  await expect(editor).toContainText("Today");
  await expect(editor).not.toContainText("Standup");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
});

test("a slash after text in a checklist item links one of the folder's chats", async ({ page }) => {
  await fakeHelper(page);
  await plantFolder(page);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");

  const editor = page.locator(".pane.focused .cm-content");
  await editor.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("\n\n- [ ] follow up on ");
  await page.keyboard.type("/chat");
  await page
    .getByRole("menu", { name: "Insert block" })
    .getByRole("menuitem", { name: /Link chat/ })
    .click();
  await page.getByRole("searchbox").fill("sonnet");
  await expect(page.getByRole("menu", { name: "Link chat" }).locator(".slashlabel")).toHaveText([
    "Sonnet chat",
  ]);
  await page.keyboard.press("Enter");

  const link = editor.locator(".rotli-wikilink", { hasText: "Sonnet chat" });
  await expect(link).toBeVisible();
  await expect(link).not.toHaveClass(/rotli-wikilink-missing/);
  await expect(editor.locator(".cm-line", { hasText: "follow up on" })).toContainText("Sonnet chat");
});

/** The next visit in Chromium: the browser remembers the folder but asks
 * again — until the page's Reconnect asks, which this stand-in grants. */
function permissionAsksAgain(page: Page) {
  return page.addInitScript(() => {
    const proto = FileSystemDirectoryHandle.prototype as unknown as {
      queryPermission: () => Promise<string>;
      requestPermission: () => Promise<string>;
    };
    const session = window.sessionStorage;
    proto.queryPermission = async () => (session.getItem("granted") ? "granted" : "prompt");
    proto.requestPermission = async () => {
      session.setItem("granted", "1");
      return "granted";
    };
  });
}

test("a folder waiting on the browser's permission is reconnected by name — no stand-in vault", async ({
  page,
}) => {
  await fakeHelper(page);
  await plantFolder(page);
  await permissionAsksAgain(page);
  await page.reload();
  // no editor until the vault itself is back
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.locator(".setup-button.primary", { hasText: /Reconnect “/ }).click();
  // granted → the page reloads from the folder
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  await expect(vaultGate(page)).toHaveCount(0);
});
// The owner, 2026-09-21: "chats need to respect the view too — this view should
// have no chats". A view lists only its own chats, even none; Main lists all.
test("a view with no chats of its own shows none in Chat, and Main shows every chat", async ({ page }) => {
  await fakeHelper(page);
  await plantFolder(page);
  await page.reload();
  const homeSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await homeSwitcher.scrollIntoViewIfNeeded();
  await homeSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Demos");
  await page.getByRole("button", { name: "Save" }).click();

  await pairAndOpenChat(page);
  const rows = page.locator(".sidebar .sb-chatrow:not(.all)");
  await expect(page.locator(".sidebar .sb-empty")).toHaveText(/No chats in Demos yet/);
  await expect(rows.filter({ hasText: "Sonnet chat" })).toHaveCount(0);

  const context = page.getByRole("group", { name: "Chat view context" });
  await context.getByRole("button", { name: /Current view: Demos/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all chats" }).click();
  await expect(rows.filter({ hasText: "Sonnet chat" })).toBeVisible();
  await expect(rows.filter({ hasText: "Gemma chat" })).toBeVisible();
});

// An EMPTY folder connected from the gate becomes a vault: the Welcome folder
// is seeded into it (as a created Mac vault gets) and its note opens. An
// existing vault (every test above) is never seeded over.
test("an empty connected folder becomes a vault and gets the Welcome folder", async ({ page }) => {
  await page.goto(APP);
  await expect(vaultGate(page)).toBeVisible();
  // the handle the picker would hand back, remembered — pointing at nothing
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
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
  });
  await page.reload();
  await expect(vaultGate(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(page.locator(".main-tree", { hasText: "Welcome" })).toBeVisible();
  // the folder is a vault now — the same spine the Mac app scaffolds — and
  // the lessons are real files inside its wiki/
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const [name] of root.entries()) names.push(name);
    const lessons: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle): Promise<void> => {
      for await (const [name, child] of dir.entries()) {
        if (child.kind === "directory") await walk(child as FileSystemDirectoryHandle);
        else lessons.push(name);
      }
    };
    await walk(await root.getDirectoryHandle("wiki"));
    const welcome = await (await root.getDirectoryHandle("wiki")).getDirectoryHandle("Welcome");
    const text = await (await (await welcome.getFileHandle("Welcome to Rotli.md")).getFile()).text();
    return { names: names.sort(), lessons: lessons.sort(), text };
  });
  for (const name of ["memex.json", "wiki", "chats", "storage", ".rotli"])
    expect(files.names).toContain(name);
  // plain Markdown, as the Mac seed writes: no Inbox shelf, which would file
  // every lesson under Captures in the Mac app
  expect(files.lessons).toContain("Welcome to Rotli.md");
  expect(files.text.startsWith("# Welcome to Rotli\n")).toBe(true);
  // and a second boot finds an existing vault: it opens on its freshest note
  // (a lesson, never an empty tab — the lessons are notes, not Captures), and
  // there is one welcome note, not two
  await page.reload();
  // lessons written in the same instant tie on mtime, so which is freshest
  // varies; what matters is that one of them opens, never an empty tab
  await expect(page.getByRole("tab", { selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).not.toHaveAttribute("title", "Untitled");
  await expect(page.locator(".main-tree").getByText("Welcome to Rotli", { exact: true })).toHaveCount(1);
});
