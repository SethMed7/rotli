import { spawnSync } from "node:child_process";
// Capture + production regression over the browser twin. Never attach to an
// existing profile or native window; only synthetic in-memory data is reachable.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:1431");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.username || origin.password)
  throw new Error("Launch captures require a local browser twin without credentials");
const output = join(import.meta.dir, "../_review/launch-captures");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let recording = false;
let frameLoop;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    recordVideo: { dir: output, size: { width: 1440, height: 900 } },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin.origin || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  let started = Date.now();
  const shots = [];
  const frames = [];
  const frameDir = join(output, `frames-${Date.now()}`);
  await mkdir(frameDir, { recursive: true });
  async function recordFrames() {
    while (recording) {
      const at = (Date.now() - started) / 1000;
      const path = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
      await page.screenshot({ path, scale: "device", caret: "hide" });
      frames.push({ path, at });
      // Lossless device-resolution capture; preserve actual event timing.
      await page.waitForTimeout(70);
    }
  }
  async function hold(name) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    shots.push({ name, startSeconds: (Date.now() - started) / 1000 });
    await page.screenshot({ path: join(output, `${name}.png`), animations: "disabled", caret: "hide" });
    // Deliberate editorial hold in the captured film, not a loading wait.
    await page.waitForTimeout(2200);
  }
  await page.goto(origin.origin);
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(false);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Breve", exact: true })).toHaveCount(0);
  // Stable builds carry no agent integrations: Connections keeps Web research only.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Remote agents" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extensions" })).toHaveCount(0);
  await expect(page.getByLabel("Relay MCP URL")).toHaveCount(0);
  await page.getByRole("button", { name: "General", exact: true }).click();
  // The Welcome folder is preseeded in Main; its notes open from the left menu.
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  const lessons = page.locator(".main-tree button[data-main-id][data-note-id]", {
    hasText:
      /^(Welcome to Rotli|Writing and formatting|Tasks and progress|Choices and toggles|Tables and code|Links and finding|Main and named views|Files and attachments|AI and privacy|Your launch checklist)$/,
  });
  await expect(lessons).toHaveCount(10);
  const rawToggle = async (mode) => {
    await page.getByRole("button", { name: "Aa", exact: true }).click();
    await page.getByRole("dialog", { name: "Typography" }).getByRole("button", { name: mode }).click();
    await page.keyboard.press("Escape");
  };
  started = Date.now();
  recording = true;
  frameLoop = recordFrames();
  await hold("main-welcome");
  await lessons.nth(2).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Tasks and progress");
  await hold("tasks-before");
  await page.getByRole("checkbox", { name: "Not started", exact: true }).click();
  await hold("tasks-done");
  await rawToggle("Raw markdown");
  await expect(page.locator(".cm-content")).toContainText("- [x] Write the first draft");
  await hold("tasks-source");
  await rawToggle("Beautified");
  await hold("tasks-beautified");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await hold("chat-front");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Breve", exact: true })).toHaveCount(0);
  recording = false;
  await frameLoop;
  const frameEnd = (Date.now() - started) / 1000;
  // Off camera: stable withholds sheets and Mermaid diagram tabs. The chooser
  // still names both, disabled and without a digit, and a ```sheet fence in a
  // note renders the unavailable block instead of mounting an editor.
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  const chooser = page.locator(".ni-surface");
  for (const label of ["Sheet", "Mermaid diagram"]) {
    const card = chooser.getByRole("button", {
      name: `New ${label} — Coming soon — not in this release yet`,
    });
    await expect(card).toHaveAttribute("aria-disabled", "true");
    await expect(card.locator(".ni-key")).toHaveCount(0);
  }
  await page.keyboard.press("5");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "New Markdown note (press 3)" }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.insertText("# Fence check\n\n```sheet\nforecast.xlsx\n```\n\nAfter the fence");
  await expect(page.locator(".rotli-render-withheld")).toHaveText(
    "Spreadsheets aren’t available in this build yet.",
  );
  const concat =
    frames
      .map((frame, index) => {
        const next = frames[index + 1]?.at ?? frameEnd;
        return `file '${frame.path.replaceAll("'", "'\\''")}'\nduration ${Math.max(0.01, next - frame.at).toFixed(3)}`;
      })
      .join("\n") + `\nfile '${frames.at(-1).path.replaceAll("'", "'\\''")}'\n`;
  const concatPath = join(frameDir, "frames.ffconcat");
  await writeFile(concatPath, concat);
  const video = page.video();
  await context.close();
  await video.saveAs(join(output, "playground-interactions.webm"));
  const encoded = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-safe",
      "0",
      "-f",
      "concat",
      "-i",
      concatPath,
      "-vf",
      "fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      join(output, "playground-interactions.mp4"),
    ],
    { stdio: "inherit" },
  );
  if (encoded.status !== 0) throw new Error("High-resolution capture encoding failed");
  await writeFile(
    join(output, "shots.json"),
    JSON.stringify(
      {
        synthetic: true,
        buildChannel: "stable",
        nativeBridge: false,
        video: "playground-interactions.mp4",
        resolution: [2880, 1800],
        firstFrameAt: frames[0].at,
        shots,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Stable launch capture passed: Home/Chat, no Breve, no agent integrations, Welcome folder in Main, real task toggle and Aa raw view, coming-soon Sheet/Mermaid cards, withheld sheet fence; synthetic in-memory data only.",
  );
} finally {
  recording = false;
  if (frameLoop) await frameLoop.catch(() => {});
  await browser.close();
}
