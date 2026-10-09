// The landing hero's product film (site/public/media/hero/), telling the landing's "Write it
// down" story: write in your view, the file lives once in your vault, the Librarian files it, ask.
// Shot from a real Rotli Web session (real controls, a visible pointer, a fresh origin-private
// vault of synthetic notes), around one clip from the Mac app, where the Librarian really runs.
//
//   ROTLI_BUILD_CHANNEL=stable bun run dev:web     # serves localhost:1437/app/
//   HERO_LIBRARIAN_CLIP=/path/to/clip.mov bun run capture:hero [http://localhost:1437/app/]
//
// Without HERO_LIBRARIAN_CLIP it makes a draft in _review/hero-video/ (a placeholder card at the
// cut) and leaves the site's film alone. site/README.md ("The hero film") has the storyboard, how
// to shoot the Mac clip (scripts/hero-librarian-vault.mjs), and what is fixture and why.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import {
  FILED,
  FILED_FIELDS,
  NOTE_LINES,
  POINTER,
  scriptedModel,
  withLibrarianFields,
} from "./hero-film-fixture.mjs";

const app = new URL(process.argv[2] ?? "http://localhost:1437/app/");
if (!["localhost", "127.0.0.1", "[::1]"].includes(app.hostname) || app.username || app.password)
  throw new Error("The hero film is shot from a local Rotli Web server without credentials");
const root = join(import.meta.dir, "..");
const review = join(root, "_review/hero-video");
const frameDir = join(review, "frames");
const siteOut = join(root, "site/public/media/hero");
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });
await mkdir(siteOut, { recursive: true });

const HELPER_PORT = 43111;
const HELPER_TOKEN = "fixture-token-with-at-least-twenty-four-chars";
// The app fills 1920 × 918 device pixels over a 162 px caption band (15%, the
// player's `--caption-band`); 80 px type stays ~15 px in a 350 px phone player.
const VIEW = { width: 1280, height: 612 };
const SCALE = 1.5;
const BAND = 1080 - VIEW.height * SCALE;
const TIMEZONE = "America/New_York"; // START is real: page clock = browser file times
const START = new Date(Math.floor(Date.now() / 60_000) * 60_000);

// the flag makes the screencast deliver device pixels, not CSS pixels
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });
await mkdir(join(review, "plates"), { recursive: true });
const marks = [];
const frames = [];
try {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    timezoneId: TIMEZONE,
  });
  await context.clock.install({ time: START });
  await context.addInitScript(POINTER);
  // nothing leaves the machine: the app's own origin and the fake helper only
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === app.origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin === `http://127.0.0.1:${HELPER_PORT}`) return route.fallback();
    return route.abort();
  });
  const page = await context.newPage();
  await page.route(`http://127.0.0.1:${HELPER_PORT}/**`, async (route) => {
    const request = route.request();
    const cors = {
      "access-control-allow-origin": request.headers()["origin"] ?? app.origin,
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      vary: "Origin",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    if (new URL(request.url()).pathname === "/health")
      return json({ ok: true, name: "rotli-helper", version: "film" });
    if (request.headers()["authorization"] !== `Bearer ${HELPER_TOKEN}`)
      return json({ error: "unauthorized" }, 401);
    const { cmd, args } = request.postDataJSON();
    if (cmd === "chat_models") return json({ result: [] });
    if (cmd === "cli_detect")
      return json({ result: { installed: true, version: "2.1.0 (Claude Code)", authenticated: true } });
    if (cmd === "cli_cancel") return json({ result: null });
    if (cmd === "cli_complete") {
      await new Promise((resolve) => setTimeout(resolve, 650)); // a model's thinking beat
      return json({ result: scriptedModel(args.prompt) });
    }
    return json({ error: "unknown command" }, 404);
  });

  // —— off camera: a fresh vault, the filed notes, chat paired, the window tidy ——
  await page.goto(app.href);
  await page.locator(".web-vault-gate h1").waitFor();
  await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("rotli-web");
      open.onsuccess = () => {
        const tx = open.result.transaction("vault", "readwrite");
        tx.objectStore("vault").put(dir, "vault-handle");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await page.getByRole("tab", { selected: true }).filter({ hasText: "Welcome to Rotli" }).waitFor();
  await page.waitForTimeout(1500); // the Welcome lessons finish writing
  const plant = (files) =>
    page.evaluate(async (entries) => {
      const dir = await navigator.storage.getDirectory();
      for (const [path, text] of Object.entries(entries)) {
        const parts = path.split("/");
        let at = dir;
        for (const part of parts.slice(0, -1)) at = await at.getDirectoryHandle(part, { create: true });
        const writable = await (await at.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await writable.write(text);
        await writable.close();
      }
    }, files);
  await plant(FILED);
  await page.reload();
  await page.getByRole("tab", { selected: true }).filter({ hasText: "Welcome to Rotli" }).waitFor();
  // Chat paired with the fake helper.
  await page.locator(".sb-switch-seg.desktop-only").click();
  const pairing = page.getByRole("dialog", { name: "Chat on the web" });
  await pairing
    .getByLabel("Paste the pairing code the helper printed:")
    .fill(`${HELPER_PORT}:${HELPER_TOKEN}`);
  await pairing.getByRole("button", { name: "Pair" }).click();
  await pairing.getByRole("button", { name: "Use Claude Code in chat" }).click();
  await pairing.getByRole("button", { name: "Done" }).click();
  // The window tidy, through Settings like anyone would: no ambient player, and Home without
  // the activity card, All notes, or Tasks, so the sidebar has room for Main and the vault.
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "General", exact: true }).click();
  const ambient = page.getByRole("switch", { name: /^Ambient audio/ });
  if ((await ambient.getAttribute("aria-checked")) === "true") await ambient.click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const name of ["Activity overview", "All notes", "Tasks"]) {
    const toggle = page.getByRole("switch", { name: new RegExp(`^${name}`) });
    if ((await toggle.getAttribute("aria-checked")) === "true") await toggle.click();
  }
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  // No note open (a new note joins the open note's folder; with none it is a row of its own in
  // Main), the Welcome lessons folded, and the System zone folded.
  const welcomeTab = page.getByRole("tab").filter({ hasText: "Welcome to Rotli" });
  await welcomeTab.hover();
  await welcomeTab.locator("button").last().click();
  const welcome = page
    .locator('.main-tree button.frow[data-main-folder="1"]', { hasText: "Welcome" })
    .first();
  if ((await welcome.getAttribute("aria-expanded")) === "true") await welcome.click();
  const system = page.locator("button.sb-syshdr");
  if ((await system.getAttribute("aria-expanded")) === "true") await system.click();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(VIEW.width * 0.62, VIEW.height * 0.55);
  await page.waitForTimeout(800);

  // —— the camera: a CDP screencast at device resolution, every frame timed; it stops at the
  // cut (the Mac clip goes there) and starts again after it ——
  const cdp = await context.newCDPSession(page);
  let writes = Promise.resolve();
  let segment = 0;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    const path = join(frameDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ path, at: metadata.timestamp, segment });
    writes = writes.then(() => writeFile(path, Buffer.from(data, "base64")));
  });
  const camera = () =>
    cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      maxWidth: VIEW.width * SCALE,
      maxHeight: VIEW.height * SCALE,
    });
  await camera();
  const mark = (name) => marks.push({ name, at: Date.now() / 1000, segment });
  const hold = (ms) => page.waitForTimeout(ms);

  // Glide the pointer to a control, then press it.
  let pointer = { x: VIEW.width * 0.62, y: VIEW.height * 0.55 };
  async function glide(x, y, ms = 520) {
    const steps = Math.max(8, Math.round(ms / 16));
    const from = pointer;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await page.mouse.move(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease);
      await page.waitForTimeout(ms / steps);
    }
    pointer = { x, y };
  }
  async function press(locator, { ms = 520, double = false, dx = 0.5 } = {}) {
    await locator.waitFor();
    let box = await locator.boundingBox();
    for (let tries = 0; !box && tries < 30; tries++) {
      await page.waitForTimeout(100); // a control mid-render has no box yet
      box = await locator.boundingBox();
    }
    if (!box) throw new Error("no box to press");
    await glide(box.x + box.width * dx, box.y + box.height / 2, ms);
    await hold(140);
    if (double) await page.mouse.dblclick(pointer.x, pointer.y);
    else await page.mouse.click(pointer.x, pointer.y);
  }
  // Quick, uneven typing — the way someone jots something down.
  async function jot(text) {
    let seed = 7;
    for (const ch of text) {
      if (ch === "\n") await page.keyboard.press("Enter");
      else await page.keyboard.type(ch);
      seed = (seed * 9301 + 49297) % 233280;
      const gap = 26 + (seed / 233280) * 44;
      await page.waitForTimeout(ch === "\n" ? 240 : /[,.?—:]/.test(ch) ? gap + 90 : gap);
    }
  }
  const centre = async (locator) => {
    const box = await locator.boundingBox();
    return [box.x + box.width * 0.45, box.y + box.height / 2];
  };
  const viewPicker = () => page.getByRole("button", { name: /^Current view: / });
  async function pickView(name) {
    await press(viewPicker());
    await hold(450);
    await press(page.getByRole("menuitemcheckbox", { name: new RegExp(`^${name}`) }));
    await hold(500);
  }
  const vaultRow = (folder) => page.locator(`.main-tree [data-main-id="main:${folder}"]`).first();
  let notePath = "";

  try {
    // 1 — write in your view: a new note in Main
    mark("write");
    await hold(900);
    await press(page.getByRole("button", { name: "New note in Main" }));
    const editor = page.locator(".pane.focused .cm-content");
    await editor.waitFor();
    await press(editor.locator(".cm-line").first(), { dx: 0.1 });
    await glide(VIEW.width * 0.78, VIEW.height * 0.34, 420); // out of the writing's way
    await jot(NOTE_LINES.join("\n"));
    await hold(700);
    // it is in Main, where you put it: its row in the view
    const mainRow = page.locator(".main-tree [data-note-id]", { hasText: "call w/ dana" }).first();
    await mainRow.waitFor({ timeout: 15_000 });
    await glide(...(await centre(mainRow)), 640);
    await hold(1700);

    // 2 — the same file, once, in your vault
    mark("vault");
    await pickView("Vault");
    await press(vaultRow("_inbox"));
    await hold(2200);

    // the cut: the Mac clip shows the Librarian filing this note
    mark("cut");
    await cdp.send("Page.stopScreencast");
    segment = 1;
    notePath = await page.evaluate(async (first) => {
      const dir = await navigator.storage.getDirectory();
      const inbox = await (await dir.getDirectoryHandle("wiki")).getDirectoryHandle("_inbox");
      for await (const [name, handle] of inbox)
        if (handle.kind === "file" && (await (await handle.getFile()).text()).includes(first))
          return `wiki/_inbox/${name}`;
      return "";
    }, NOTE_LINES[0]);
    if (!notePath) throw new Error("the note written on camera is not in wiki/_inbox");
    // what the Librarian did in the clip: its fields on top, the words untouched, into Clients
    const typed = await page.evaluate(async (path) => {
      const parts = path.split("/");
      let at = await navigator.storage.getDirectory();
      for (const part of parts.slice(0, -1)) at = await at.getDirectoryHandle(part);
      const text = await (await at.getFileHandle(parts.at(-1))).getFile().then((f) => f.text());
      await at.removeEntry(parts.at(-1));
      return text;
    }, notePath);
    notePath = notePath.replace("wiki/_inbox/", "wiki/Clients/");
    await writeFile(join(review, "note-before-filing.md"), typed);
    await plant({ [notePath]: withLibrarianFields(typed) });
    await page.reload();
    await page.locator(".pane.focused .cm-content").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await hold(600);
    await camera();

    // 3 — after the Librarian: the file in Clients (the Mac clip showed its fields), the words
    // untouched, and Main just as you left it
    mark("after");
    if ((await viewPicker().getAttribute("aria-label"))?.includes("Main")) await pickView("Vault");
    await press(vaultRow("Clients"));
    await hold(900);
    await press(page.locator(".main-tree [data-note-id]", { hasText: "call w/ dana" }).first());
    await hold(600);
    // filed into Clients (the location says so), the words as typed
    await glide(...(await centre(page.locator(".status-inline .ed-loc"))), 640);
    await hold(1600);
    await glide(VIEW.width * 0.5, VIEW.height * 0.32, 600);
    await hold(1400);
    // and Main as you left it
    await pickView("Main");
    await glide(
      ...(await centre(page.locator(".main-tree [data-note-id]", { hasText: "call w/ dana" }).first())),
      600,
    );
    await hold(2000);

    // 4 — ask, and the AI reads only what it needs
    mark("ask");
    await press(page.getByRole("button", { name: "Chat", exact: true }));
    await hold(500);
    await press(page.getByRole("button", { name: "New chat", exact: true }));
    const composer = page.getByPlaceholder(/Message rotli/).first();
    await press(composer, { dx: 0.3 });
    await jot("What did Dana want, and what's left?");
    await hold(250);
    await page.keyboard.press("Enter");
    await page.getByText("Still open: ask Jo about the discount").waitFor({ timeout: 20_000 });
    await glide(VIEW.width * 0.86, VIEW.height * 0.5, 600);
    await hold(3600);
    mark("end");
  } catch (error) {
    await page.screenshot({ path: join(review, "failure.png") });
    throw error;
  }

  await cdp.send("Page.stopScreencast");
  await writes;
  // the vault on screen, as files: what the film claims is what is on disk
  const files = await page.evaluate(async () => {
    const out = {};
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir) {
        if (handle.kind === "directory") await walk(handle, `${prefix}${name}/`);
        else if (name.endsWith(".md")) out[prefix + name] = await (await handle.getFile()).text();
      }
    }
    await walk(await navigator.storage.getDirectory(), "");
    return out;
  });
  await writeFile(join(review, "vault-after.json"), JSON.stringify(files, null, 2) + "\n");
  const filed = files[notePath];
  const fields = FILED_FIELDS.split("\n").filter((line) => line && line !== "---");
  if (
    !filed ||
    !fields.every((line) => filed.includes(line)) ||
    !NOTE_LINES.every((line) => filed.includes(line))
  )
    throw new Error("the note written on camera is not filed in wiki/Clients/ with its words untouched");
  if (
    Object.keys(files).some((path) => path.startsWith("wiki/_inbox/") && files[path].includes(NOTE_LINES[0]))
  )
    throw new Error("the note written on camera was left in wiki/_inbox/ too");
  await context.close();
} finally {
  await browser.close();
}

// —— edit: each take's frames → a raw take, the Mac clip between them, caption plates over the
// whole, web encode, poster ——
function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}
const markAt = (name) => marks.find((m) => m.name === name);
// One take: its frames, each held until the next, ending at `endAt` (wall clock).
async function take(index, endAt) {
  const own = frames.filter((frame) => frame.segment === index);
  if (own.length === 0) throw new Error(`take ${index + 1} has no frames`);
  const concat =
    own
      .map(
        (frame, i) =>
          `file '${frame.path}'\nduration ${Math.max(0.001, (own[i + 1]?.at ?? endAt) - frame.at).toFixed(4)}`,
      )
      .join("\n") + `\nfile '${own.at(-1).path}'\n`;
  const list = join(frameDir, `take-${index + 1}.ffconcat`);
  await writeFile(list, concat);
  const out = join(review, `take-${index + 1}.mp4`);
  ffmpeg([
    "-safe",
    "0",
    "-f",
    "concat",
    "-i",
    list,
    "-vf",
    "fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "12",
    out,
  ]);
  return { path: out, start: own[0].at, length: endAt - own[0].at };
}
const takeA = await take(0, markAt("cut").at);
const takeB = await take(1, markAt("end").at);

// The Mac clip, fitted into the same 1920 × (1080 − band) picture on the app's own ground. Without
// one, a placeholder card holds the cut and the film stays a draft.
const clipPath = process.env.HERO_LIBRARIAN_CLIP;
const draft = !clipPath;
const PICTURE = { w: VIEW.width * SCALE, h: VIEW.height * SCALE };
const clip = join(review, "take-mac.mp4");
if (clipPath) {
  ffmpeg([
    "-i",
    clipPath,
    "-vf",
    `scale=${PICTURE.w}:${PICTURE.h}:force_original_aspect_ratio=decrease,pad=${PICTURE.w}:${PICTURE.h}:(ow-iw)/2:(oh-ih)/2:color=0xF8F2E9,fps=30,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "12",
    clip,
  ]);
} else {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=0xF1E7D8:s=${PICTURE.w}x${PICTURE.h}:d=4:r=30`,
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    clip,
  ]);
}
const clipLength = Number(
  spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip], {
    encoding: "utf8",
  }).stdout.trim(),
);
const parts = join(review, "takes.ffconcat");
await writeFile(parts, [takeA.path, clip, takeB.path].map((path) => `file '${path}'`).join("\n") + "\n");
const raw = join(review, "hero-raw.mp4");
ffmpeg(["-safe", "0", "-f", "concat", "-i", parts, "-c", "copy", raw]);

// The film's clock: take A, then the clip, then take B.
const at = (name) => {
  const m = markAt(name);
  return m.segment === 0 ? m.at - takeA.start : takeA.length + clipLength + (m.at - takeB.start);
};
const clipFrom = takeA.length;
const clipTo = takeA.length + clipLength;
const duration = at("end");

const CAPTIONS = [
  { text: "Write in your view.", from: at("write") + 0.4, to: at("vault") - 0.3 },
  { text: "The file lives once, in your vault.", from: at("vault") + 0.2, to: clipFrom - 0.2 },
  {
    text: draft ? "[Mac clip: the Librarian files it]" : "On the Mac, the Librarian files it.",
    from: clipFrom + 0.2,
    to: clipTo - 0.2,
  },
  { text: "Your words untouched. Your view as you left it.", from: clipTo + 0.2, to: at("ask") - 0.3 },
  { text: "Ask, and the AI reads only what it needs.", from: at("ask") + 0.2, to: duration },
];
const font = (await readFile(join(root, "site/public/fonts/GeneralSans-Medium.woff2"))).toString("base64");
const plateBrowser = await chromium.launch();
try {
  const plate = await plateBrowser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [i, caption] of CAPTIONS.entries()) {
    await plate.setContent(`<style>
      @font-face { font-family: GS; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 500; }
      html, body { margin: 0; background: transparent; }
      body { width: 1920px; height: 1080px; display: flex; align-items: flex-end; justify-content: center; }
      span { height: ${BAND}px; display: flex; align-items: center; color: #3a3028; font: 500 80px/1 GS; letter-spacing: -0.01em; white-space: nowrap; }
    </style><span>${caption.text}</span>`);
    await plate.evaluate(() => document.fonts.ready);
    // one line, clear of the edges: a longer caption needs fewer words, not smaller type
    if ((await plate.$eval("span", (el) => el.getBoundingClientRect().width)) > 1760)
      throw new Error(`caption ${i + 1} is wider than 1760 px; shorten it`);
    caption.png = join(review, `plates/caption-${i + 1}.png`);
    await plate.screenshot({ path: caption.png, omitBackground: true });
  }
} finally {
  await plateBrowser.close();
}
const inputs = ["-i", raw];
// the caption band: the site's ground, a hairline above it
const chain = [
  `[0:v]pad=1920:1080:0:0:color=0xF8F2E9,drawbox=x=0:y=${1080 - BAND}:w=1920:h=2:color=0xE6D8C4:t=fill[base]`,
];
let last = "[base]";
for (const [i, c] of CAPTIONS.entries()) {
  const length = c.to - c.from;
  const final = i === CAPTIONS.length - 1; // stays on the frame the player rests on
  const fadeOut = final ? "" : `,fade=t=out:st=${(length - 0.3).toFixed(3)}:d=0.3:alpha=1`;
  inputs.push("-loop", "1", "-t", length.toFixed(3), "-i", c.png);
  chain.push(
    `[${i + 1}:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1${fadeOut},setpts=PTS-STARTPTS+${c.from.toFixed(3)}/TB[c${i}]`,
    `${last}[c${i}]overlay=0:0:eof_action=${final ? "repeat" : "pass"}[v${i}]`,
  );
  last = `[v${i}]`;
}
// JPEG frames are full range; browsers expect broadcast range
chain.push(`${last}scale=out_range=tv,format=yuv420p[out]`);
last = "[out]";
// A draft (no Mac clip yet) never replaces the site's film.
const film = draft ? join(review, "rotli-hero-draft.mp4") : join(siteOut, "rotli-hero.mp4");
ffmpeg([
  ...inputs,
  "-filter_complex",
  chain.join(";"),
  "-map",
  last,
  "-t",
  duration.toFixed(3),
  "-c:v",
  "libx264",
  "-preset",
  "veryslow",
  "-tune",
  "stillimage",
  "-crf",
  process.env.HERO_CRF ?? "18",
  "-pix_fmt",
  "yuv420p",
  "-color_range",
  "tv",
  "-r",
  "30",
  "-movflags",
  "+faststart",
  "-map_metadata",
  "-1",
  "-an",
  film,
]);
// the poster: the note written in Main, before the vault
const posterPng = join(review, "poster.png");
ffmpeg(["-ss", (at("vault") - 0.6).toFixed(3), "-i", film, "-frames:v", "1", posterPng]);
const poster = draft ? join(review, "rotli-hero-poster-draft.webp") : join(siteOut, "rotli-hero-poster.webp");
const webp = spawnSync("cwebp", ["-quiet", "-q", "82", posterPng, "-o", poster], { stdio: "inherit" });
if (webp.status !== 0) throw new Error("cwebp failed");
// six evenly spaced frames for review
for (let i = 0; i < 6; i++)
  ffmpeg([
    "-ss",
    ((duration * (i + 0.5)) / 6).toFixed(3),
    "-i",
    film,
    "-frames:v",
    "1",
    join(review, `frame-${i + 1}.png`),
  ]);
const size = (await stat(film)).size;
await writeFile(
  join(review, "film.json"),
  JSON.stringify(
    {
      synthetic: true,
      duration,
      bytes: size,
      draft,
      marks: marks.map((m) => ({ name: m.name, at: at(m.name) })),
      captions: CAPTIONS.map(({ text, from, to }) => ({ text, from, to })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Hero film${draft ? " (draft, no Mac clip)" : ""}: ${duration.toFixed(1)} s, ${(size / 1e6).toFixed(2)} MB → ${draft ? "_review/hero-video/" : "site/public/media/hero/"}`,
);
if (size > 6e6) throw new Error("The hero film is over the 6 MB budget; raise HERO_CRF");
