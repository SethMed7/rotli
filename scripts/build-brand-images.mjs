// Render rotli's brand images from the SVG templates in scripts/brand-images/,
// with the site's bundled fonts, in Chromium with the network off (the same
// renderer as build-social-card.mjs), then palette-compress each PNG.
//
//   site/public/og/<page>.png             1200×630  each page's link card (site/src/og.ts)
//   site/public/og/blog/<slug>.png        1200×630  each published post's card, from its title
//   site/public/thumbs/blog/<slug>.webp   1200×630  every post's thumbnail (and -600.webp): its scene, no words
//   site/public/banners/blog/<slug>.webp  2400×1000 every published post's banner (and -1200.webp), the
//                                         same scene composed wide, and -mobile.webp (1300×900), its phone crop
//   brand/assets/banners/*.png            X, LinkedIn, GitHub, YouTube
//   brand/assets/pfp/*.png                1024×1024 face mark on four theme-family grounds
//   brand/assets/thumbnails/*.png         1280×720  the title-slot template and one per post
//   _review/brand-images/contact-sheet.png  everything at a glance (gitignored)
//
// Every text block is fitted (shrunk to its line limit) and then checked: it
// must sit inside the image's safe area and clear of the quokka. Contrast is a
// token check only: the title and line colors (TEXT_PAIRS) must reach 4.5:1 on
// the solid warm ground. Text over the pattern, sea, sand, or ink underline is
// not sampled, so look at the contact sheet. Any failure stops the run.
//
//   bun run build:brand-images
//   bun run build:brand-images --thumbnail "A title" [--pose notes] [--out path.png]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import sharp from "sharp";

import {
  bannerPath,
  OG_CARDS,
  POSES,
  postArt,
  postPose,
  thumbnailAlt,
  thumbnailPath,
} from "../site/src/og.ts";
import { quokka } from "./brand-images/quokka.mjs";
import { cardBeside, MOBILE_CROP, quokkaSize, scene } from "./brand-images/scenes.mjs";
import { banner, C, card, pfp, TEXT_PAIRS, textCss } from "./brand-images/templates.mjs";

const root = join(import.meta.dir, "..");
const { values: args } = parseArgs({
  options: { thumbnail: { type: "string" }, pose: { type: "string" }, out: { type: "string" } },
});

// ── contrast ──────────────────────────────────────────────────────────────
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
for (const [name, fg, bg] of TEXT_PAIRS) {
  const ratio = contrast(fg, bg);
  if (ratio < 4.5) throw new Error(`${name} text ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under 4.5:1`);
  console.log(`contrast ${name}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
}

// ── fonts and art ─────────────────────────────────────────────────────────
const fontFaces = (
  await Promise.all(
    [
      ["General Sans", 500, "GeneralSans-Medium.woff2", "font/woff2"],
      ["General Sans", 600, "GeneralSans-Semibold.woff2", "font/woff2"],
      ["Baloo 2", 600, "Baloo2-600.ttf", "font/ttf"],
    ].map(async ([family, weight, file, mime]) => {
      const bytes = await readFile(join(root, "site/public/fonts", file));
      return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:${mime};base64,${bytes.toString("base64")})}`;
    }),
  )
).join("");
const art = new Map();
const pose = async (name, size = 900) => {
  if (!(name in POSES))
    throw new Error(`Unknown quokka pose "${name}" (one of ${Object.keys(POSES).join(", ")})`);
  const key = `${name}@${size}`;
  if (!art.has(key)) art.set(key, await quokka(name, { size }));
  return art.get(key);
};

// ── rendering ─────────────────────────────────────────────────────────────
// Runs in the page: shrink each title until it fits its block and line limit,
// then report any text outside the safe area or over the quokka.
function fitAndCheck() {
  const problems = [];
  const lines = (el) =>
    Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  const overflows = (el) => el.parentElement.scrollHeight > el.parentElement.clientHeight + 0.5;
  for (const el of document.querySelectorAll("[data-fit]")) {
    let size = parseFloat(el.style.fontSize);
    while ((lines(el) > Number(el.dataset.maxLines) || overflows(el)) && size > Number(el.dataset.min)) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }
  for (const el of document.querySelectorAll("[data-max-lines]")) {
    if (lines(el) > Number(el.dataset.maxLines) || overflows(el))
      problems.push(`"${el.textContent}" does not fit its block`);
  }
  const box = (el) => el.getBoundingClientRect();
  const inside = (r, s) =>
    r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5;
  const near = (a, b, gap) =>
    a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
  const safe = [...document.querySelectorAll("[data-safe]")];
  const keepouts = [...document.querySelectorAll("[data-keepout]")].map((el) => ({
    kind: el.dataset.keepout,
    ...box(el).toJSON(),
  }));
  for (const el of document.querySelectorAll("[data-text]")) {
    let rects = [box(el)];
    if (!(el instanceof SVGElement)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      rects = [...range.getClientRects()];
    }
    for (const r of rects) {
      if (!safe.every((s) => inside(r, box(s))))
        problems.push(`"${el.textContent.trim()}" leaves the safe area`);
      for (const k of keepouts.filter((k) => near(r, k, 16)))
        problems.push(`"${el.textContent.trim()}" runs into the ${k.kind}`);
    }
  }
  // Banners: the quokka must be inside the area every platform shows (scenery may run past it).
  for (const s of document.querySelectorAll("[data-safe][data-art]")) {
    if (!keepouts.every((k) => k.kind !== "quokka" || inside(k, box(s))))
      problems.push("the quokka leaves the safe area");
  }
  return [...new Set(problems)];
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.route("**/*", (route) => route.abort());
const rendered = [];

async function render(path, svg, { width, height, group, half = true }) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><style>${fontFaces}${textCss}body{margin:0}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  if (
    !(await page.evaluate(() =>
      [...document.fonts].every((font) => font.status === "loaded" || font.status === "unloaded"),
    ))
  ) {
    throw new Error(`${path}: a font failed to load`);
  }
  const problems = await page.evaluate(fitAndCheck);
  if (problems.length > 0) throw new Error(`${path}:\n  ${problems.join("\n  ")}`);
  const raw = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  if (path.endsWith(".webp")) return writeWebp(path, raw, { width, height, group, half });
  const png = await sharp(raw)
    .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
    .toBuffer();
  const out = join(root, path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, png);
  rendered.push({ path, group, width, height, bytes: png.length });
  console.log(`${path}  ${width}×${height}  ${Math.round(png.length / 1024)} KB`);
}

// The site's pictures: webp at the rendered width and at half of it (`<name>-600.webp`), for srcset.
async function writeWebp(path, raw, { width, height, group, half }) {
  for (const size of half ? [width, width / 2] : [width]) {
    const out = size === width ? path : path.replace(/\.webp$/, `-${size}.webp`);
    const webp = await sharp(raw).resize(size).webp({ quality: 80, effort: 6 }).toBuffer();
    await mkdir(dirname(join(root, out)), { recursive: true });
    await writeFile(join(root, out), webp);
    console.log(`${out}  ${size}×${(size * height) / width}  ${Math.round(webp.length / 1024)} KB`);
    if (size === width) rendered.push({ path: out, group, width, height, bytes: webp.length });
  }
}

const thumbnail = async (title, poseName) =>
  card({ w: 1280, h: 720, title, art: await pose(poseName), titleSize: 82, label: `${title} — rotli` });

try {
  if (args.thumbnail) {
    const out = args.out ?? `brand/assets/thumbnails/custom.png`;
    await render(out, await thumbnail(args.thumbnail, args.pose ?? "notes"), { width: 1280, height: 720 });
  } else {
    await buildAll();
    await contactSheet();
  }
} finally {
  await browser.close();
}

/** Every post, with its title read from its frontmatter at render time. */
async function allPosts() {
  const dir = join(root, "site/src/content/writing/posts");
  const posts = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".md")).sort()) {
    const front = (await readFile(join(dir, file), "utf8")).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const data = Bun.YAML.parse(front);
    const date = new Date(data.date).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
    const status = data.status ?? "published";
    posts.push({ slug: file.replace(/\.md$/, ""), title: data.title, date, status });
  }
  return posts;
}

async function buildAll() {
  for (const [name, entry] of Object.entries(OG_CARDS)) {
    const svg = card({
      w: 1200,
      h: 630,
      ...entry,
      art: await pose(entry.pose),
      inked: name === "home" ? "the filing." : undefined,
    });
    await render(`site/public/og/${name}.png`, svg, {
      width: 1200,
      height: 630,
      group: "Link cards (site/public/og/)",
    });
  }
  const everyPost = await allPosts();
  // Every post has a thumbnail, coming-soon ones too (the index marks those); only published
  // posts have a page, so only they get a link card.
  for (const post of everyPost) {
    const art = postArt(post.slug);
    await render(
      `site/public${thumbnailPath(post.slug)}`,
      scene({
        kind: art.scene,
        art: await pose(art.pose, quokkaSize(art.scene, "thumb")),
        label: thumbnailAlt(post.slug),
      }),
      { width: 1200, height: 630, group: "Post thumbnails (site/public/thumbs/blog/)" },
    );
  }
  const posts = everyPost.filter((post) => post.status === "published");
  for (const post of posts) {
    const svg = card({
      w: 1200,
      h: 630,
      title: post.title,
      line: `rotli blog · ${post.date}`,
      art: await pose(postPose(post.slug)),
      beside: cardBeside(postArt(post.slug).scene),
    });
    await render(`site/public/og/blog/${post.slug}.png`, svg, {
      width: 1200,
      height: 630,
      group: "Link cards (site/public/og/)",
    });
  }

  // Only a published post has a page, so only it gets a banner.
  for (const post of everyPost.filter((item) => item.status === "published")) {
    const art = postArt(post.slug);
    const wide = {
      kind: art.scene,
      art: await pose(art.pose, quokkaSize(art.scene, "wide")),
      layout: "wide",
    };
    const group = { group: "Post banners (site/public/banners/blog/)" };
    await render(`site/public${bannerPath(post.slug)}`, scene({ ...wide, label: thumbnailAlt(post.slug) }), {
      width: 2400,
      height: 1000,
      ...group,
    });
    await render(
      `site/public${bannerPath(post.slug, "mobile")}`,
      scene({ ...wide, label: thumbnailAlt(post.slug), crop: MOBILE_CROP }),
      { width: MOBILE_CROP[2], height: MOBILE_CROP[3], half: false, ...group },
    );
  }

  const home = OG_CARDS.home;
  const waving = await pose("waving");
  const bannerGroup = { group: "Banners (brand/assets/banners/)" };
  await render(
    "brand/assets/banners/x-header-1500x500.png",
    banner({
      w: 1500,
      h: 500,
      k: 0.8,
      label: "rotli — write like a person, let AI do the filing",
      safe: { x: 60, y: 60, w: 1380, h: 380 },
      title: home.title,
      art: waving,
      text: { x: 110, y: 160, w: 820, h: 170, size: 72, wordmark: 38, inked: "the filing." },
      quokkaAt: { x: 1260, footY: 436, size: 400 },
      lighthouseAt: { x: 1010, s: 0.72 },
      clouds: [{ x: 880, y: 96, s: 0.8 }],
    }),
    { width: 1500, height: 500, ...bannerGroup },
  );
  await render(
    "brand/assets/banners/linkedin-banner-1128x191.png",
    banner({
      w: 1128,
      h: 191,
      k: 0.42,
      label: "rotli — write like a person, let AI do the filing",
      safe: { x: 200, y: 10, w: 918, h: 175 },
      title: home.title,
      line: home.line,
      art: waving,
      text: { x: 236, y: 44, w: 640, h: 100, size: 34, lineSize: 17, maxLines: 1, inked: "the filing." },
      quokkaAt: { x: 1010, footY: 158, size: 158 },
    }),
    { width: 1128, height: 191, ...bannerGroup },
  );
  await render(
    "brand/assets/banners/github-social-preview-1280x640.png",
    card({
      w: 1280,
      h: 640,
      title: home.title,
      line: home.line,
      art: waving,
      inked: "the filing.",
      scenery: true,
    }),
    { width: 1280, height: 640, ...bannerGroup },
  );
  await render(
    "brand/assets/banners/youtube-channel-art-2560x1440.png",
    banner({
      w: 2560,
      h: 1440,
      k: 1.2,
      label: "rotli — write like a person, let AI do the filing",
      safe: { x: 507, y: 508, w: 1546, h: 423 },
      title: home.title,
      line: home.line,
      art: await pose("waving", 1200),
      text: { x: 580, y: 610, w: 980, h: 300, size: 80, lineSize: 30, wordmark: 46, inked: "the filing." },
      quokkaAt: { x: 1850, footY: 905, size: 420 },
      lighthouseAt: { x: 2290, s: 1.25 },
      clouds: [
        { x: 300, y: 380, s: 1.4 },
        { x: 1500, y: 300, s: 1.1 },
        { x: 2200, y: 520, s: 1 },
      ],
    }),
    { width: 2560, height: 1440, ...bannerGroup },
  );

  // The face mark, cropped at its shoulders so the body runs off the bottom edge.
  const face = await quokka("_logo-bold", { size: 1024, viewBox: "52 -74 1150 1150", openBottom: true });
  // Each family's signature ground from src/styles/themes.css: Rotli, Ocean, and
  // Grove light (`--ground` of rotli/ocean-light/grove-light), Midnight dark
  // (--swatch-midnight-dark); Midnight's light ground is a near-white grey.
  const grounds = { rotli: C.ground, ocean: "#dfebf3", grove: "#e3eee4", midnight: "#050607" };
  for (const [family, ground] of Object.entries(grounds)) {
    await render(
      `brand/assets/pfp/rotli-pfp-${family}.png`,
      pfp({ size: 1024, ground, art: face, label: `rotli quokka on ${family}` }),
      {
        width: 1024,
        height: 1024,
        group: "Profile pictures (brand/assets/pfp/)",
      },
    );
  }

  const thumbGroup = { width: 1280, height: 720, group: "Thumbnails (brand/assets/thumbnails/)" };
  await render(
    "brand/assets/thumbnails/template.png",
    await thumbnail("Your title goes here, in a line or two", "notes"),
    thumbGroup,
  );
  for (const post of posts) {
    await render(
      `brand/assets/thumbnails/${post.slug}.png`,
      await thumbnail(post.title, postPose(post.slug)),
      thumbGroup,
    );
  }
}

// ── contact sheet ─────────────────────────────────────────────────────────
async function contactSheet() {
  const groups = Map.groupBy(rendered, (item) => item.group);
  const sections = [];
  for (const [group, items] of groups) {
    const tiles = [];
    for (const item of items) {
      const mime = item.path.endsWith(".webp") ? "image/webp" : "image/png";
      const uri = `data:${mime};base64,${(await readFile(join(root, item.path))).toString("base64")}`;
      const width = Math.min(
        item.width,
        item.width > 2000 ? 1100 : item.height < 300 ? 1128 : item.width === 1024 ? 260 : 560,
      );
      const round = item.width === 1024 ? `<img src="${uri}" style="width:120px;border-radius:50%">` : "";
      tiles.push(
        `<figure><div class="pair"><img src="${uri}" style="width:${width}px">${round}</div><figcaption>${item.path} · ${item.width}×${item.height} · ${Math.round(item.bytes / 1024)} KB</figcaption></figure>`,
      );
    }
    sections.push(`<h2>${group}</h2><div class="grid">${tiles.join("")}</div>`);
  }
  // A link preview at feed size: how legible the cards stay small.
  const small = rendered
    .filter((item) => item.path.startsWith("site/public/og/"))
    .map(async (item) => `<img src="data:image/png;base64,${await base64(item.path)}" style="width:300px">`);
  const html = `<!doctype html><style>${fontFaces}body{margin:0;padding:40px;background:#efe6d8;font-family:"General Sans";color:${C.text}}
    h1{font-size:30px;margin:0 0 8px}h2{font-size:20px;margin:36px 0 14px}.grid{display:flex;flex-wrap:wrap;gap:22px}
    figure{margin:0}img{display:block;box-shadow:0 1px 0 #cdb8a1,0 0 0 1px #e2d3c1}.pair{display:flex;gap:14px;align-items:flex-end}
    figcaption{font-size:13px;color:${C.muted};margin-top:6px}</style><body style="width:2400px">
    <h1>rotli brand images</h1><div style="font-size:14px;color:${C.muted}">bun run build:brand-images · ${rendered.length} images</div>
    ${sections.join("")}<h2>Link cards at feed size (300 px)</h2><div class="grid">${(await Promise.all(small)).join("")}</div></body>`;
  await page.setViewportSize({ width: 2480, height: 1000 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const out = join(root, "_review/brand-images/contact-sheet.png");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    await sharp(await page.screenshot({ fullPage: true }))
      .png({ palette: true })
      .toBuffer(),
  );
  console.log("_review/brand-images/contact-sheet.png");
}

async function base64(path) {
  return (await readFile(join(root, path))).toString("base64");
}
