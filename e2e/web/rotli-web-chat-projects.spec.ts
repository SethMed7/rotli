// Rotli Web: chat folders are projects. A folder an older build wrote — same
// `.rotli/chat-folders.json`, an unknown key and all — shows as a project in
// the Chat front's Projects list; its chat wears the project's tag; the
// project opens as a page in a tab with its chats; and adding another chat
// from that chat's menu writes the manifest back without losing the unknown
// key. Driven through real controls, never chords.

import { expect, type Page, test } from "@playwright/test";

import { readOpfsFile, startWithFolder } from "./support";

const PORT = 43131;
const TOKEN = "fixture-token-with-at-least-twenty-four-chars";

const chatFile = (title: string, updated: string) =>
  `---\nid: ${updated}-${title}\ntitle: ${title}\nsource: rotli\nattachedTo:\nparticipants: [you]\ncreated: ${updated}\nupdated: ${updated}\ntags: [chat]\n---\n\n# ${title}\n\n## Messages\n\n**you** · ${updated}T10:00:00Z — hello\n`;

// exactly what a 1.9.6 build writes, plus a key from some newer build
const OLDER_MANIFEST = JSON.stringify(
  {
    version: 1,
    folders: [{ id: "cf-launch01", name: "Launch", color: "teal" }],
    assignments: { "kickoff-chat": "cf-launch01" },
    order: {},
  },
  null,
  2,
);

const FOLDER: Record<string, string> = {
  "wiki/projects/hello.md":
    "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\nshelf: [Inbox]\n---\n\n# Hello\n\nA note.\n",
  ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: "01TESTNOTE0000000000000001" }] }),
  ".rotli/settings.json": JSON.stringify({ onboarded: true, chatModelId: "sonnet" }),
  ".rotli/chat-folders.json": OLDER_MANIFEST,
  "chats/kickoff-chat.md": chatFile("Kickoff chat", "2026-11-20"),
  "chats/budget-chat.md": chatFile("Budget chat", "2026-11-21"),
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

test("an older build's chat folder is a project: listed, tagged, opened as a page, and added to", async ({
  page,
}) => {
  await fakeHelper(page);
  await startWithFolder(page, FOLDER);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  await page.locator(".sb-switch-seg.desktop-only").click();
  const dialog = page.getByRole("dialog", { name: "Chat on the web" });
  await dialog.getByLabel("Paste the pairing code the helper printed:").fill(`${PORT}:${TOKEN}`);
  await dialog.getByRole("button", { name: "Pair" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Paired with" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator(".sb-switch-seg", { hasText: /^Chat/ }).click();

  // the folder is a project, and its chat wears the project's tag
  const projects = page.getByRole("group", { name: "Projects" });
  const launch = projects.getByRole("button", { name: "Open project Launch, 1 chats" });
  await expect(launch).toBeVisible();
  await expect(page.locator('.sb-chatrow[data-chat-slug="kickoff-chat"] .sb-chattag')).toHaveText("Launch");
  await expect(page.locator('.sb-chatrow[data-chat-slug="budget-chat"] .sb-chattag')).toHaveCount(0);

  // the project opens as a page in a tab, listing its chats
  await launch.click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Launch");
  const pageBody = page.locator(".project-page");
  await expect(pageBody.getByRole("button", { name: "Launch — rename project" })).toBeVisible();
  await expect(pageBody.getByRole("button", { name: "Kickoff chat" })).toBeVisible();
  await expect(pageBody.getByRole("button", { name: "Add instructions" })).toBeVisible();

  // Add to project, from the other chat's own menu
  // the row's action button shows on hover, the way a person reaches it
  await page.locator('.sb-chatrow[data-chat-slug="budget-chat"]').hover();
  await page.getByRole("button", { name: "More actions for Budget chat" }).click();
  await page.getByRole("menuitem", { name: "Add to project" }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Launch" })
    .or(page.getByRole("menuitem", { name: "Launch" }))
    .click();
  await expect(page.locator('.sb-chatrow[data-chat-slug="budget-chat"] .sb-chattag')).toHaveText("Launch");
  await expect(pageBody.getByRole("button", { name: "Budget chat" })).toBeVisible();

  // the manifest is the same file, with the new chat and the unknown key kept
  await expect
    .poll(async () => JSON.parse(await readOpfsFile(page, ".rotli/chat-folders.json")) as unknown)
    .toMatchObject({
      version: 1,
      folders: [{ id: "cf-launch01", name: "Launch", color: "teal" }],
      assignments: { "kickoff-chat": "cf-launch01", "budget-chat": "cf-launch01" },
    });
});
