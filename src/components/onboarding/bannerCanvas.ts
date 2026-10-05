// The thank-you banner (2026-09-28), drawn on a canvas: the person's own
// quokka on their theme's ground, their name, and their choices.
//
// The quokka is copied from a rendered <Character>, layer by layer, from its
// computed styles (mask, fill, transform, clip) — so the banner shows exactly
// the quokka the app shows, accessory placement included, without a second
// copy of that geometry. CSS masks can't cross into a canvas any other way.

import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  type BannerText,
  clipPolygon,
  maskUrl,
  transformMatrix,
} from "../../lib/thanksBanner";

function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image.decode().then(() => image);
}

/** A mask image filled with one color, contained in a square, like the CSS. */
async function tintedMask(src: string, color: string, px: number): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  // an SVG with only a viewBox has no intrinsic size; the quokka's are square
  const [iw, ih] =
    image.naturalWidth && image.naturalHeight ? [image.naturalWidth, image.naturalHeight] : [px, px];
  const fit = Math.min(px / iw, px / ih);
  const [w, h] = [iw * fit, ih * fit];
  ctx.drawImage(image, (px - w) / 2, (px - h) / 2, w, h);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, px, px);
  return canvas;
}

/** The inline line drawing as an image, its currentColor resolved. */
function lineImage(svg: SVGSVGElement, color: string, px: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(px));
  clone.setAttribute("height", String(px));
  clone.style.color = color;
  const markup = new XMLSerializer().serializeToString(clone);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
}

async function layerSource(
  layer: Element,
  style: CSSStyleDeclaration,
  px: number,
): Promise<CanvasImageSource | null> {
  if (layer.classList.contains("quokka-layer")) {
    const mask = style.maskImage || style.getPropertyValue("-webkit-mask-image");
    if (!mask || mask === "none") return null;
    const src = maskUrl(mask);
    // never drop a layer quietly: a hat missing from the banner is a bug
    if (!src) throw new Error("a quokka layer’s mask could not be read");
    return tintedMask(src, style.backgroundColor, px);
  }
  if (layer.classList.contains("quokka-line")) {
    const svg = layer.querySelector("svg");
    return svg ? lineImage(svg, style.color, px) : null;
  }
  if (layer instanceof HTMLImageElement) return loadImage(layer.currentSrc || layer.src);
  return null;
}

/** Draw a rendered `.quokka` into `ctx` at (x, y), `size` pixels square. */
export async function drawQuokka(
  ctx: CanvasRenderingContext2D,
  host: HTMLElement,
  x: number,
  y: number,
  size: number,
): Promise<void> {
  const box = host.getBoundingClientRect().width || size;
  const k = size / box;
  const layers = [...host.children];
  // load every layer first, then paint in DOM order
  const sources = await Promise.all(
    layers.map((layer) => {
      const style = getComputedStyle(layer);
      return layerSource(layer, style, Math.ceil(size)).then((source) => ({ source, style }));
    }),
  );
  for (const { source, style } of sources) {
    if (!source) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    const matrix = transformMatrix(style.transform);
    if (matrix && style.transform !== "none") {
      const [ox = 0, oy = 0] = style.transformOrigin.split(" ").map((part) => Number.parseFloat(part));
      ctx.translate(ox, oy);
      ctx.transform(...matrix);
      ctx.translate(-ox, -oy);
    }
    const clip = clipPolygon(style.clipPath, box, box);
    if (clip) {
      ctx.beginPath();
      clip.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(source, 0, 0, box, box);
    ctx.restore();
  }
}

/** Theme colors as the canvas can read them (rgb), resolved through a probe
 * so a token defined with color-mix() or another var() still works. */
export function themeColors(): Record<"ground" | "accent" | "text" | "muted", string> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const colors = {
    ground: read("--ground"),
    accent: read("--accent"),
    text: read("--text"),
    muted: read("--text-muted"),
  };
  probe.remove();
  return colors;
}

function fontStack(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "system-ui, sans-serif";
}

/** The largest size ≤ `max` at which `text` fits `width`. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  family: string,
  max: number,
  width: number,
) {
  let size = max;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 28 && ctx.measureText(text).width > width) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

/** The whole banner as a PNG. `quokka` is a rendered <Character> host. */
export async function composeBanner(quokka: HTMLElement, text: BannerText): Promise<Blob> {
  await document.fonts.ready;
  const colors = themeColors();
  const display = fontStack("--font-display");
  const body = fontStack("--font-body");
  const canvas = document.createElement("canvas");
  canvas.width = BANNER_WIDTH;
  canvas.height = BANNER_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
  // a soft sun behind the quokka, in the accent
  ctx.fillStyle = colors.accent;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(330, 330, 250, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(1110, 70, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // the quokka stands centered in the sun
  const quokkaSize = 440;
  const quokkaAt = 330 - quokkaSize / 2;
  await drawQuokka(ctx, quokka, quokkaAt, quokkaAt, quokkaSize);

  const left = 610;
  const width = BANNER_WIDTH - left - 70;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.text;
  // one line when it fits large; a long name moves to a line of its own
  let lines = [text.headline];
  let size = fitFont(ctx, text.headline, 700, display, 60, width);
  const comma = text.headline.indexOf(", ");
  if (size < 46 && comma > 0) {
    lines = [text.headline.slice(0, comma + 1), text.headline.slice(comma + 2)];
    size = Math.min(...lines.map((line) => fitFont(ctx, line, 700, display, 56, width)));
    ctx.font = `700 ${size}px ${display}`;
  }
  // a thank-you, centered on the sun: the headline and one line under it
  let y = lines.length > 1 ? 240 : 290;
  for (const line of lines) {
    ctx.fillText(line, left, y);
    y += Math.round(size * 1.15);
  }
  ctx.fillStyle = colors.muted;
  ctx.font = `500 26px ${body}`;
  y += 4;
  ctx.fillText(text.subline, left, y, width);

  ctx.fillStyle = colors.muted;
  ctx.font = `600 24px ${display}`;
  ctx.textAlign = "right";
  ctx.fillText("rotli.co", BANNER_WIDTH - 70, BANNER_HEIGHT - 60);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("the banner could not be drawn"))),
      "image/png",
    ),
  );
}
