// SVG templates for rotli's brand images: one island-by-day family (the story
// film's palette, as site/public/social-card.svg uses it) laid out per format.
// Text sits in a foreignObject so the browser wraps and balances it; the
// renderer (scripts/build-brand-images.mjs) fits it and checks it stays inside
// `data-safe` and clear of every `data-keepout`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

// The site's tokens, read from site/src/layouts/Base.astro's first :root block (its Rotli Light
// values), because these images render outside the page. One home for every colour: a token
// changed there changes every picture at the next render.
const baseCss = readFileSync(join(root, "site/src/layouts/Base.astro"), "utf8");
const rootBlock = baseCss.slice(baseCss.indexOf(":root {"), baseCss.indexOf("}", baseCss.indexOf(":root {")));
const token = (name) => {
  const value = rootBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\b`, "i"))?.[1];
  if (!value) throw new Error(`Base.astro has no --${name} colour token`);
  return value.toLowerCase();
};

export const C = {
  ground: token("ground"),
  text: token("text"),
  muted: token("muted-ink"),
  accent: token("accent"),
  /** The drawn scenes' line: the art's own ink (--ink), the quokka's and every prop's. */
  ink: token("ink"),
  line: token("ink"),
  sea: token("sea"),
  seaDeep: token("sea-deep"),
  seaLine: token("sea-line"),
  sand: token("sand"),
  limestone: token("limestone"),
  olive: token("olive"),
  oliveBright: token("olive-bright"),
  lantern: token("lantern"),
  wood: token("wood"),
  woodDark: token("wood-dark"),
  lake: token("lake"),
  /** Paper: the app's editor paper (--capture-ground), what every page and screen is drawn on. */
  paper: token("capture-ground"),
  /** The day sky and its clouds: the guides' scenes' warm surfaces, the other way round. */
  sky: token("surface-2"),
  cloud: token("surface"),
};

export const esc = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const markPaths = readFileSync(join(root, "src/assets/characters/_logo-bold.svg"), "utf8")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replaceAll("currentColor", C.text);
const underline = `url("data:image/svg+xml,${encodeURIComponent(
  readFileSync(join(root, "site/public/ink-underline.svg"), "utf8").replace(
    'stroke-width="6"',
    'stroke-width="7"',
  ),
)}")`;

// A faint tile of notes, a folder, and a checklist (the social card's), faded out around the text.
function filePattern({ w, h, fade, k = 1 }) {
  const [cx, cy, rx, ry] = fade;
  return `<defs>
    <pattern id="files" width="160" height="160" patternUnits="userSpaceOnUse" patternTransform="scale(${k})"><g fill="none" stroke="${C.text}" stroke-opacity="0.09" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><g transform="translate(18 22) rotate(-8)"><path d="M0 0h20l8 8v28H0z M20 0v8h8"/><path d="M5 15h16M5 21h16M5 27h10"/></g><g transform="translate(96 30) rotate(6)"><path d="M0 4h11l4 4h19v22H0z"/></g><g transform="translate(40 100) rotate(5)"><path d="M0 0h26v34H0z"/><path d="M5 9h5v5H5zM14 11h8M5 20h5v5H5zM14 22h8"/></g><g transform="translate(112 104) rotate(-4)"><path d="M0 0h18l7 7v25H0z M18 0v7h7"/><path d="M5 14h14M5 20h9"/></g></g></pattern>
    <radialGradient id="files-fade" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${cx} ${cy}) scale(${rx} ${ry})"><stop offset="0.6" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
    <mask id="files-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="url(#files-fade)"/></mask>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#files)" mask="url(#files-mask)"/>`;
}

/** The bay: a deep edge line, then shallow water with a scatter of wave marks. */
export function sea({ w, h, top, k = 1 }) {
  const waves = [];
  const rows = Math.max(1, Math.floor((h - top - 30 * k) / (26 * k)));
  for (let i = 0; i < Math.ceil(w / (90 * k)); i += 1) {
    const x = (i * 90 + ((i * 37) % 50)) * k;
    const y = top + 26 * k + ((i * 7) % rows) * 26 * k;
    waves.push(`<path d="M${x} ${y}q${10 * k} ${-6 * k} ${20 * k} 0"/>`);
  }
  return `<rect x="0" y="${top}" width="${w}" height="${h - top}" fill="${C.sea}"/>
  <rect x="0" y="${top}" width="${w}" height="${9 * k}" fill="${C.seaDeep}"/>
  <g fill="none" stroke="${C.seaLine}" stroke-width="${3 * k}" stroke-linecap="round">${waves.join("")}</g>`;
}

/**
 * A beach under the quokka's feet at (x, footY): sand rising from the water with
 * the film's ink line along its top, ending at `bottom` (a sand bar with a rounded
 * underside when that is above the image's edge).
 */
export function beach({ x, footY, bottom, k = 1 }) {
  const top = footY - 18 * k;
  const left = x - 300 * k;
  const right = x + 340 * k;
  const d = `M${left} ${bottom}C${x - 220 * k} ${bottom - 40 * k} ${x - 120 * k} ${top} ${x} ${top}S${x + 260 * k} ${top + 8 * k} ${right} ${bottom}C${x + 160 * k} ${bottom + 22 * k} ${x - 120 * k} ${bottom + 22 * k} ${left} ${bottom}Z`;
  return `<path d="${d}" fill="${C.sand}" stroke="${C.line}" stroke-width="${3 * k}" stroke-linejoin="round"/>`;
}

/** The lighthouse on its limestone hill, anchored at the hill's base center. */
export function lighthouse({ x, y, s }) {
  return `<g transform="translate(${x} ${y}) scale(${s})" stroke-linejoin="round">
    <path d="M-195 0C-117 -30 -60 -88 0 -88S126.75 -26 195 0Z" fill="${C.limestone}" stroke="${C.line}" stroke-width="3"/>
    <ellipse cx="-90" cy="-48" rx="22" ry="9" fill="${C.oliveBright}"/><ellipse cx="-60" cy="-58" rx="18" ry="8" fill="${C.olive}"/><ellipse cx="55" cy="-60" rx="20" ry="8" fill="${C.oliveBright}"/><ellipse cx="95" cy="-44" rx="24" ry="9" fill="${C.olive}"/>
    <g transform="translate(0 -84) scale(0.95)" stroke="${C.line}" stroke-width="3">
      <path d="M-17 0l5-92h24l5 92z" fill="${C.cloud}"/><path d="M-15 -30h30M-16 -60h32" stroke-opacity="0.35"/>
      <rect x="-17" y="-98" width="34" height="6" fill="${C.line}"/><rect x="-10" y="-118" width="20" height="20" fill="${C.lantern}"/>
      <path d="M-13 -118q13-16 26 0z" fill="${C.line}"/><rect x="-4" y="-20" width="8" height="14" fill="${C.accent}" stroke="none"/>
    </g>
    <rect data-keepout="lighthouse" x="-22" y="-200" width="44" height="120" fill="none"/><rect data-keepout="lighthouse" x="-110" y="-88" width="220" height="60" fill="none"/>
  </g>`;
}

export function cloud({ x, y, s }) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="56" ry="16" fill="${C.cloud}"/><ellipse cx="-34" cy="4" rx="30" ry="13" fill="${C.cloud}"/><ellipse cx="26" cy="-9" rx="32" ry="15" fill="${C.cloud}"/><path d="M-66 12q50 9 128 1" fill="none" stroke="${C.muted}" stroke-opacity="0.45" stroke-width="2.5" stroke-linecap="round"/></g>`;
}

/** The site header's brand: the quokka mark and the Baloo 2 wordmark, top-left at (x, y). */
function wordmark({ x, y, size }) {
  const mark = size * 1.25;
  return `<svg x="${x}" y="${y}" width="${mark}" height="${mark}" viewBox="0 0 1254 1254" aria-hidden="true">${markPaths}</svg>
  <text data-text x="${x + mark + size * 0.2}" y="${y + mark * 0.8}" fill="${C.text}" font-family="'Baloo 2', sans-serif" font-size="${size}" font-weight="600" letter-spacing="${-size * 0.012}">rotli</text>`;
}

/** The quokka at (x, y, size), with its visible bounds as a keep-out for text. */
export function character(art, { x, y, size }) {
  const { left, top, right, bottom } = art.box;
  return `<image href="${art.uri}" x="${x}" y="${y}" width="${size}" height="${size}"/>
  <rect data-keepout="quokka" x="${x + left * size}" y="${y + top * size}" width="${(right - left) * size}" height="${(bottom - top) * size}" fill="none"/>`;
}

/**
 * The headline block: a title (shrunk to fit `maxLines`, never below `minSize`)
 * and an optional quieter line, vertically centered in its box.
 */
function textBlock({ x, y, w, h, title, line, size, minSize, maxLines, lineSize, inked, align = "center" }) {
  let titleHtml = esc(title);
  if (inked && title.endsWith(inked))
    titleHtml = `${esc(title.slice(0, -inked.length))}<span class="inked">${esc(inked)}</span>`;
  return `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}">
    <div xmlns="http://www.w3.org/1999/xhtml" class="block" style="height:${h}px;justify-content:${align}">
      <div class="title" data-text data-fit data-min="${minSize}" data-max-lines="${maxLines}" style="font-size:${size}px">${titleHtml}</div>
      ${line ? `<div class="line" data-text data-max-lines="2" style="font-size:${lineSize}px">${esc(line)}</div>` : ""}
    </div>
  </foreignObject>`;
}

/** CSS for every template's text (fonts are added by the renderer). */
export const textCss = `
  .block { display: flex; flex-direction: column; gap: 0; box-sizing: border-box; }
  .title { font-family: 'General Sans', sans-serif; font-weight: 600; line-height: 1.06; letter-spacing: -0.035em; color: ${C.text}; text-wrap: balance; }
  .line { font-family: 'General Sans', sans-serif; font-weight: 500; line-height: 1.35; letter-spacing: -0.005em; color: ${C.muted}; text-wrap: pretty; margin-top: 0.85em; }
  .inked { background: ${underline} left bottom / 100% 0.2em no-repeat; padding-bottom: 0.1em; }
`;

/** Text/background pairs every template uses, for the contrast check. */
export const TEXT_PAIRS = [
  ["title", C.text, C.ground],
  ["line", C.muted, C.ground],
];

const svgOpen = (w, h, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;

/**
 * A link card or thumbnail: wordmark top-left, the headline block on the left,
 * the quokka standing on a beach at the right, the bay along the bottom.
 * Measurements are on a 1200 × 630 grid, scaled by `k` (the height ratio).
 */
export function card({
  w,
  h,
  title,
  line,
  art,
  inked,
  titleSize = title.length <= 16 ? 88 : 68,
  scenery = false,
  label,
  beside,
}) {
  const k = h / 630;
  const pad = 72 * k;
  const seaTop = h - 74 * k;
  const qSize = 500 * k;
  const footX = w - 214 * k;
  const footY = h - 34 * k;
  const qx = footX - qSize / 2;
  const qy = footY - art.box.bottom * qSize;
  // `beside({ footX, footY, k })`: a prop on its own stretch of beach left of the quokka; the text keeps clear of it.
  const prop = beside?.({ footX, footY, k, qSize });
  const artLeft = Math.min(qx + art.box.left * qSize, prop?.left ?? Infinity);
  const textW = Math.min(artLeft - pad - 36 * k, 660 * k);
  const textTop = 150 * k;
  return `${svgOpen(w, h, label ?? title)}
  <rect width="${w}" height="${h}" fill="${C.ground}"/>
  ${filePattern({ w, h, k, fade: [pad + textW / 2, textTop + 170 * k, textW * 0.95, 330 * k] })}
  ${scenery ? `${cloud({ x: w * 0.56, y: 96 * k, s: 0.9 * k })}${lighthouse({ x: footX - 250 * k, y: seaTop + 2 * k, s: 0.6 * k })}` : ""}
  ${sea({ w, h, top: seaTop, k })}
  ${prop?.ground ?? ""}
  ${beach({ x: footX, footY, bottom: h + 30 * k, k })}
  ${prop?.svg ?? ""}
  ${character(art, { x: qx, y: qy, size: qSize })}
  ${wordmark({ x: pad, y: 52 * k, size: 40 * k })}
  ${textBlock({ x: pad, y: textTop, w: textW, h: seaTop - textTop - 30 * k, title, line, size: titleSize * k, minSize: 44 * k, maxLines: 3, lineSize: 26 * k, inked })}
  <rect data-safe x="${pad - 1}" y="${40 * k}" width="${w - 2 * pad + 2}" height="${seaTop - 40 * k}" fill="none"/>
</svg>`;
}

/**
 * A wide banner: the bay along the bottom, the lighthouse, and the quokka on its
 * beach; wordmark and headline inside `safe` (the area every platform shows).
 */
export function banner({
  w,
  h,
  safe,
  k,
  title,
  line,
  art,
  text,
  quokkaAt,
  lighthouseAt,
  clouds = [],
  label,
}) {
  const seaTop = quokkaAt.footY + 18 * k;
  const qSize = quokkaAt.size;
  const qx = quokkaAt.x - qSize / 2;
  const qy = quokkaAt.footY - art.box.bottom * qSize;
  return `${svgOpen(w, h, label)}
  <rect width="${w}" height="${h}" fill="${C.ground}"/>
  ${filePattern({ w, h, k, fade: [text.x + text.w / 2, text.y + text.h / 2, text.w * 0.9, text.h * 1.4] })}
  ${clouds.map((c) => cloud(c)).join("")}
  ${lighthouseAt ? lighthouse({ ...lighthouseAt, y: seaTop + 2 * k }) : ""}
  ${sea({ w, h, top: seaTop, k })}
  ${beach({ x: quokkaAt.x, footY: quokkaAt.footY, bottom: Math.min(h + 30 * k, seaTop + 70 * k), k })}
  ${character(art, { x: qx, y: qy, size: qSize })}
  ${text.wordmark ? wordmark({ x: text.x, y: text.y - text.wordmark * 1.9, size: text.wordmark }) : ""}
  ${textBlock({ x: text.x, y: text.y, w: text.w, h: text.h, title, line, size: text.size, minSize: text.size * 0.8, maxLines: text.maxLines ?? 2, lineSize: text.lineSize, inked: text.inked, align: "flex-start" })}
  <rect data-safe data-art x="${safe.x}" y="${safe.y}" width="${safe.w}" height="${safe.h}" fill="none"/>
</svg>`;
}

/** A profile picture: the face mark, filled, on one theme family's ground. */
export function pfp({ size, ground, art, label }) {
  return `${svgOpen(size, size, label)}
  <rect width="${size}" height="${size}" fill="${ground}"/>
  <image href="${art.uri}" x="0" y="0" width="${size}" height="${size}"/>
</svg>`;
}
