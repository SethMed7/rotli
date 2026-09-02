// The app theme as a PDF palette. Breve's renderer runs outside the webview
// (a bun process printing through headless Chrome), so "match my Rotli theme"
// means the main window resolves its six live semantic tokens to plain hex
// and hands them to Rust, which merges them into the routine config the
// renderer reads (audit 2026-09-02 §1.4). Pure given a token reader, so the
// mapping is testable without a DOM.

import { BREVE_PDF_TOKEN_ROLES, type BrevePdfPaletteLike } from "./brevePdfThemes";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Normalize any CSS colour the theme layer emits to `#rrggbb`. Hex passes
 * through; `oklch(...)` (the custom accent hue) and `rgb(...)` go through a
 * canvas fill round-trip, which is the one colour parser every WebKit and
 * Chromium build agrees on. Returns null for anything it cannot resolve. */
export function toHex6(value: string, canvas?: CanvasRenderingContext2D | null): string | null {
  const trimmed = value.trim();
  if (HEX6.test(trimmed)) return trimmed.toLowerCase();
  const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const ctx = canvas === undefined ? scratchContext() : canvas;
  if (!ctx) return null;
  ctx.fillStyle = "#000000";
  ctx.fillStyle = trimmed;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === undefined || a === 0) return null;
  return rgbToHex(r ?? 0, g ?? 0, b ?? 0);
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

let scratch: CanvasRenderingContext2D | null | undefined;
function scratchContext(): CanvasRenderingContext2D | null {
  if (scratch !== undefined) return scratch;
  if (typeof document === "undefined") return (scratch = null);
  const el = document.createElement("canvas");
  el.width = 1;
  el.height = 1;
  scratch = el.getContext("2d", { willReadFrequently: true });
  return scratch;
}

/** Resolve the live theme into a complete PDF palette, or null when any role
 * cannot be read — a partial palette is never sent (the renderer would mix it
 * with a fallback and produce unreadable contrast). `read` returns the
 * computed value of one custom property. */
export function livePdfPalette(
  read: (token: string) => string,
  canvas?: CanvasRenderingContext2D | null,
): BrevePdfPaletteLike | null {
  const out: Partial<BrevePdfPaletteLike> = {};
  for (const [role, token] of Object.entries(BREVE_PDF_TOKEN_ROLES) as Array<
    [keyof BrevePdfPaletteLike, string]
  >) {
    const hex = toHex6(read(token), canvas);
    if (!hex) return null;
    out[role] = hex;
  }
  return out as BrevePdfPaletteLike;
}

/** The document's applied theme tokens (the main window's `:root`). When
 * `expectedTheme` is given, a read against a document that has not applied
 * that theme yet returns null instead of the previous theme's colours — the
 * caller re-reads once the attribute lands. */
export function readDocumentPdfPalette(expectedTheme?: string): BrevePdfPaletteLike | null {
  if (typeof document === "undefined") return null;
  if (expectedTheme !== undefined && (document.documentElement.dataset.theme ?? "light") !== expectedTheme)
    return null;
  const styles = getComputedStyle(document.documentElement);
  return livePdfPalette((token) => styles.getPropertyValue(token));
}
