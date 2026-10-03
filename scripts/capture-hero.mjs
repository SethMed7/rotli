// The landing hero's product film (site/public/media/hero/), shot from a real
// Rotli Web session: real controls clicked with a visible pointer, a fresh
// origin-private vault holding synthetic notes only, never a live vault or the
// Mac app. Run Rotli Web locally first:
//
//   ROTLI_BUILD_CHANNEL=stable bun run dev:web     # serves 127.0.0.1:1437/app/
//   bun run capture:hero [http://127.0.0.1:1437/app/]
//
// What is fixture, and why (site/README.md, "The hero film"):
// - The Library's filed notes (wiki/Travel, wiki/People, wiki/Home) are planted
//   as files carrying the Librarian's own frontmatter fields. The Librarian
//   runs only in the Mac app, so the film shows its result, never a live run.
// - Chat runs through a fake Rotli Helper on loopback (the e2e/web/
//   rotli-helper.spec.ts pattern). The app's real agent loop sends every
//   prompt; the fake answers with scripted model text, and the search and the
//   note reads in between are the app's own, over the vault on screen.
// - The page clock and time zone are fixed so the dates on screen agree
//   (see START below).
//
// Output: _review/hero-video/ (frames, raw take, caption plates, contact frames)
// and the encoded film + poster in site/public/media/hero/.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const app = new URL(process.argv[2] ?? "http://127.0.0.1:1437/app/");
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
// The app fills 1920 × 918 device pixels; the film's 1920 × 1080 frame adds a
// 162 px caption band below it, so a caption never covers the UI it describes.
// The band and its 80 px type are sized for phones: a 390 px-wide page shows the
// film about 350 px wide, which keeps a caption near 15 px. The site's player
// keeps its controls above the band (FilmPlayer.astro `--caption-band`, 15%).
const VIEW = { width: 1280, height: 612 };
const SCALE = 1.5;
const BAND = 1080 - VIEW.height * SCALE;
const CAPTION_PX = 80;
// The page clock starts at the real time, so the app's clock and the vault's
// file times (the browser's own, which a page clock cannot move) agree: a note
// written on camera reads "just now".
const TIMEZONE = "America/New_York";
const START = new Date(Math.floor(Date.now() / 60_000) * 60_000);

// —— the synthetic vault: notes the Librarian filed earlier, by area ——
const FILED = {
  "wiki/Travel/Lisbon trip.md": `---
area: Travel
summary: Four days in Lisbon with Ana, May 14 to 18.
tags: [travel, lisbon]
links: ["[[Ana]]"]
filed_by: librarian
---
# Lisbon trip

May 14–18 · staying in Alfama

- [x] Book the apartment in Alfama
- [ ] Tram 28 tickets
- [ ] Pick a fado night
`,
  "wiki/Travel/Packing list.md": `---
area: Travel
tags: [travel]
filed_by: librarian
---
# Packing list

- [ ] Plug adapter
- [ ] Walking shoes
- [ ] Rain jacket
`,
  "wiki/People/Ana.md": `---
area: People
tags: [friends]
filed_by: librarian
---
# Ana

Friend from the design meetup. Vegetarian. Prefers late flights.
`,
  "wiki/Home/Groceries.md": `---
area: Home
tags: [errands]
filed_by: librarian
---
# Groceries

Olive oil, sourdough, oat milk, blueberries.
`,
};

// —— the scripted model behind the fake helper: it asks the app to search and
// read, then answers only from what those real tool results returned ——
const ANSWER = [
  "Three things are still open:",
  "",
  "- **Book the tile museum**",
  "- **Ask Ana about flights**",
  "- **Tram 28 tickets** (go early, before the crowds)",
  "",
  "The apartment in Alfama is already booked for May 14–18.",
].join("\n");
function scriptedModel(prompt) {
  if (prompt.startsWith("System: You name conversations")) return "Lisbon loose ends";
  if (prompt.startsWith("You maintain the running notes"))
    return "- Still open for Lisbon: tile museum, flights with Ana, tram 28 tickets";
  if (!prompt.includes("STEP 1 ACTION"))
    return JSON.stringify({ tool: "search_notes", args: { query: "Lisbon" } });
  if (!prompt.includes("STEP 2 ACTION")) {
    const hits = JSON.parse(prompt.match(/STEP 1 RESULT[^\n]*\n<result>\n(.*)\n<\/result>/)[1]);
    const capture = hits.find((hit) => hit.title.startsWith("lisbon w/"));
    if (!capture) throw new Error("search did not return the note written on camera");
    return JSON.stringify({ tool: "read_note", args: { id: capture.id } });
  }
  if (!prompt.includes("STEP 3 ACTION"))
    return JSON.stringify({ tool: "read_note", args: { id: "wiki/Travel/Lisbon trip.md" } });
  return JSON.stringify({ final: ANSWER });
}

// The pointer the film shows (Playwright's own is invisible in captures): an
// arrow that follows real mouse events, plus a ring on each press.
const POINTER = `(() => {
  const mount = () => {
    const style = document.createElement("style");
    style.textContent = \`
      #hero-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
        width: 24px; height: 24px; transform: translate(-100px, -100px); transition: opacity 200ms; }
      .hero-press { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px;
        margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid #c97e62;
        animation: hero-press 420ms ease-out forwards; }
      @keyframes hero-press { from { transform: scale(0.4); opacity: 0.9; } to { transform: scale(1.2); opacity: 0; } }\`;
    const pointer = document.createElement("div");
    pointer.id = "hero-pointer";
    pointer.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 3l13.5 10.2-6 .9 3.6 6.7-2.6 1.4-3.6-6.8L5 19.6z" fill="#3a3028" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.append(style, pointer);
    addEventListener("mousemove", (e) => { pointer.style.transform = \`translate(\${e.clientX - 5}px, \${e.clientY - 3}px)\`; }, true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      ring.className = "hero-press";
      ring.style.left = e.clientX + "px";
      ring.style.top = e.clientY + "px";
      document.documentElement.append(ring);
      setTimeout(() => ring.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount); else mount();
})();`;

// the flag makes the screencast deliver device pixels, not CSS pixels
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });
// The image dropped on camera: a drawn panel of blue-and-white tiles.
await mkdir(join(review, "plates"), { recursive: true });
{
  const tilePage = await browser.newPage({ viewport: { width: 440, height: 248 } });
  const tile = `<g><rect width="80" height="80" fill="#f4efe4"/><rect x="2" y="2" width="76" height="76" fill="none" stroke="#2f5d9b" stroke-width="2"/>
    <path d="M40 8c8 12 8 20 0 32-8-12-8-20 0-32zM40 72c8-12 8-20 0-32-8 12-8 20 0 32zM8 40c12-8 20-8 32 0-12 8-20 8-32 0zM72 40c-12-8-20-8-32 0 12 8 20 8 32 0z" fill="#2f5d9b"/>
    <circle cx="40" cy="40" r="6" fill="#e2a33b"/><path d="M0 0h14L0 14zM80 0H66l14 14zM0 80h14L0 66zM80 80H66l14-14z" fill="#2f5d9b"/></g>`;
  const cells = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 8; x++) cells.push(`<use href="#t" x="${x * 80}" y="${y * 80}"/>`);
  await tilePage.setContent(
    `<body style="margin:0"><svg width="440" height="248" viewBox="0 0 640 360"><defs>${tile.replace("<g>", '<g id="t">')}</defs>${cells.join("")}</svg></body>`,
  );
  await tilePage.screenshot({ path: join(review, "plates/tiles.png") });
  await tilePage.close();
}
const marks = [];
const frames = [];
let filmStart = 0;
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

  // —— off camera: a fresh vault, the filed notes, chat paired ——
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
  await page.evaluate(async (files) => {
    const dir = await navigator.storage.getDirectory();
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split("/");
      let at = dir;
      for (const part of parts.slice(0, -1)) at = await at.getDirectoryHandle(part, { create: true });
      const writable = await (await at.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    }
  }, FILED);
  await page.reload();
  await page.getByRole("tab", { selected: true }).filter({ hasText: "Welcome to Rotli" }).waitFor();
  await page.locator(".sb-switch-seg.desktop-only").click();
  const pairing = page.getByRole("dialog", { name: "Chat on the web" });
  await pairing
    .getByLabel("Paste the pairing code the helper printed:")
    .fill(`${HELPER_PORT}:${HELPER_TOKEN}`);
  await pairing.getByRole("button", { name: "Pair" }).click();
  await pairing.getByRole("button", { name: "Use Claude Code in chat" }).click();
  await pairing.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(VIEW.width * 0.62, VIEW.height * 0.55);
  await page.waitForTimeout(800);

  // —— the camera: a CDP screencast at device resolution, every frame timed ——
  const cdp = await context.newCDPSession(page);
  let writes = Promise.resolve();
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    const path = join(frameDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ path, at: metadata.timestamp });
    writes = writes.then(() => writeFile(path, Buffer.from(data, "base64")));
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: VIEW.width * SCALE,
    maxHeight: VIEW.height * SCALE,
  });
  filmStart = Date.now() / 1000;
  const mark = (name) => marks.push({ name, at: Date.now() / 1000 - filmStart });
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

  try {
    // 1 — write however you think
    mark("write");
    await hold(900);
    await press(page.getByRole("button", { name: /^New…/ }).first());
    const chooser = page.locator(".ni-surface");
    await hold(700);
    await press(chooser.getByRole("button", { name: /New Markdown note/ }));
    const editor = page.locator(".pane.focused .cm-content");
    await editor.waitFor();
    await press(editor.locator(".cm-line").first(), { dx: 0.1 });
    await glide(VIEW.width * 0.78, VIEW.height * 0.34, 420); // out of the writing's way
    await jot(
      "lisbon w/ ana — may 14??\ntram 28 early, before the crowds\n- [ ] book the tile museum\nask Ana re: flights\n",
    );
    await page.keyboard.press("Enter"); // an empty item ends the list
    await hold(350);
    // an image dropped from the desktop: the drop the app receives, from a file
    const image = await readFile(join(review, "plates/tiles.png"));
    await editor.evaluate((host, base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "tiles.png", { type: "image/png" }));
      const line = [...host.querySelectorAll(".cm-line")].at(-1).getBoundingClientRect();
      host.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: line.left + 4,
          clientY: line.top + line.height / 2,
        }),
      );
    }, image.toString("base64"));
    await editor.locator('img[src^="blob:"]').first().waitFor();
    await hold(900);
    await page.keyboard.press("ControlOrMeta+End");
    // "Lisbon t", not "Lis": the note being written (just now, so ranked first) is
    // titled "lisbon w/ ana…" and would otherwise be the first choice
    await jot("\nsee [[Lisbon t");
    await page.locator(".rotli-linkpick").waitFor();
    await page.locator(".rotli-linkpick-title").first().filter({ hasText: "Lisbon trip" }).waitFor();
    await hold(800);
    await page.keyboard.press("Enter");
    await hold(1600);

    // 2 — captures wait; the Librarian files notes into the Library
    mark("library");
    await press(editor.locator(".rotli-wikilink").first());
    await page.getByRole("tab", { selected: true }).filter({ hasText: "Lisbon trip" }).waitFor();
    await hold(1900);
    await press(page.locator("[role=option]", { hasText: "Library" }).first());
    await hold(1300);
    await press(page.getByText("Travel", { exact: true }).first(), { double: true });
    await hold(1900);

    // 3 — find it again
    mark("find");
    await press(page.getByRole("button", { name: /Search notes and actions/ }), { dx: 0.3 });
    await hold(300);
    await jot("tile");
    await page.locator(".prow", { hasText: "lisbon w/" }).first().waitFor();
    await hold(1700);
    await page.keyboard.press("Enter");
    await page.getByRole("tab", { selected: true }).filter({ hasText: "lisbon w/" }).waitFor();
    await hold(1400);

    // 4 — ask your notes
    mark("ask");
    await press(page.getByRole("button", { name: "Chat", exact: true }));
    await hold(500);
    await press(page.getByRole("button", { name: "New chat", exact: true }));
    const composer = page.getByPlaceholder(/Message rotli/).first();
    await press(composer, { dx: 0.3 });
    await jot("What's still open for Lisbon?");
    await hold(250);
    await page.keyboard.press("Enter");
    await page.getByText("Three things are still open").waitFor({ timeout: 20_000 });
    await glide(VIEW.width * 0.86, VIEW.height * 0.5, 600);
    await hold(3200);

    // 5 — plain Markdown files, yours to keep
    mark("files");
    await press(page.getByRole("button", { name: "Home", exact: true }));
    await hold(400);
    await press(page.getByRole("tab").filter({ hasText: "lisbon w/" }).first());
    await hold(700);
    await press(page.getByRole("button", { name: "Aa", exact: true }));
    await hold(600);
    await press(
      page.getByRole("dialog", { name: "Typography" }).getByRole("button", { name: "Raw markdown" }),
    );
    await hold(250);
    await page.keyboard.press("Escape");
    await glide(VIEW.width * 0.9, VIEW.height * 0.62, 600);
    await hold(3800);
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
  const capture = Object.values(files).find((text) => text.includes("book the tile museum"));
  if (!capture?.includes("[[Lisbon trip]]") || !capture.includes("![](storage:images/tiles.png)"))
    throw new Error("the note written on camera is not in the vault as Markdown");
  await context.close();
} finally {
  await browser.close();
}

// —— edit: frames → raw take, caption plates over it, web encode, poster ——
function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}
const t0 = frames[0].at;
const end = filmStart + marks.at(-1).at; // wall clock of the last mark
const concat =
  frames
    .map(
      (frame, i) =>
        `file '${frame.path}'\nduration ${Math.max(0.001, (frames[i + 1]?.at ?? end) - frame.at).toFixed(4)}`,
    )
    .join("\n") + `\nfile '${frames.at(-1).path}'\n`;
await writeFile(join(frameDir, "frames.ffconcat"), concat);
const raw = join(review, "hero-raw.mp4");
ffmpeg([
  "-safe",
  "0",
  "-f",
  "concat",
  "-i",
  join(frameDir, "frames.ffconcat"),
  "-vf",
  "fps=30,format=yuv420p",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "12",
  raw,
]);
const offset = filmStart - t0; // screencast clock vs. wall clock
const at = (name) => marks.find((m) => m.name === name).at + offset;
const duration = at("end");

const CAPTIONS = [
  { text: "Write however you think.", from: at("write") + 0.4, to: at("library") - 0.3 },
  {
    text: "The Librarian files notes into your Library.",
    from: at("library") + 0.2,
    to: at("find") - 0.3,
  },
  { text: "Find anything again.", from: at("find") + 0.2, to: at("ask") - 0.3 },
  { text: "Ask your notes.", from: at("ask") + 0.2, to: at("files") - 0.3 },
  { text: "Plain Markdown files, in a folder you own.", from: at("files") + 0.2, to: duration },
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
      span { height: ${BAND}px; display: flex; align-items: center; color: #3a3028; font: 500 ${CAPTION_PX}px/1 GS; letter-spacing: -0.01em; white-space: nowrap; }
    </style><span>${caption.text}</span>`);
    await plate.evaluate(() => document.fonts.ready);
    // one line, clear of the edges: a longer caption needs fewer words, not smaller type
    const width = await plate.$eval("span", (el) => el.getBoundingClientRect().width);
    if (width > 1760) throw new Error(`caption ${i + 1} is ${Math.round(width)} px wide; keep it under 1760`);
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
  // the last caption stays on the frame the player rests on (under "Watch again")
  const final = i === CAPTIONS.length - 1;
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
const film = join(siteOut, "rotli-hero.mp4");
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
// the poster: the written note, image and link in place, before the Library
const posterPng = join(review, "poster.png");
ffmpeg(["-ss", (at("library") - 0.6).toFixed(3), "-i", film, "-frames:v", "1", posterPng]);
const poster = join(siteOut, "rotli-hero-poster.webp");
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
      marks: marks.map((m) => ({ ...m, at: m.at + offset })),
      captions: CAPTIONS.map(({ text, from, to }) => ({ text, from, to })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Hero film: ${duration.toFixed(1)} s, ${(size / 1e6).toFixed(2)} MB → site/public/media/hero/`);
if (size > 6e6) throw new Error("The hero film is over the 6 MB budget; raise HERO_CRF");
