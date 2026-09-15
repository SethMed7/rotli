// The run-property (`w:rPr`) subset Rotli owns. Everything else inside an
// original run's properties is preserved by the codec around these tags.
//
// Background is written as run shading, `<w:shd w:val="clear" w:fill="RRGGBB"/>`,
// because the editor offers arbitrary hex swatches and `w:highlight` only has
// sixteen named colors. Word paints `w:highlight` over shading, so both are
// owned: a Word-authored highlight decodes to its hex and is replaced on save.

import type { DocumentTextStyle } from "../model";
import { decodeXml, enabled, encodeXml, val } from "./xml";

export const RUN_STYLE_TAGS = [
  "rFonts",
  "b",
  "i",
  "u",
  "strike",
  "color",
  "sz",
  "szCs",
  "shd",
  "highlight",
  "vertAlign",
] as const;

const HIGHLIGHT_HEX: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  cyan: "00FFFF",
  green: "00FF00",
  magenta: "FF00FF",
  red: "FF0000",
  yellow: "FFFF00",
  white: "FFFFFF",
  darkblue: "000080",
  darkcyan: "008080",
  darkgreen: "008000",
  darkmagenta: "800080",
  darkred: "800000",
  darkyellow: "808000",
  darkgray: "808080",
  lightgray: "C0C0C0",
};

const HEX = /^[0-9a-f]{6}$/i;

function background(props: string): string | undefined {
  const highlight = HIGHLIGHT_HEX[(val(props, "highlight") ?? "").toLowerCase()];
  if (highlight) return `#${highlight}`;
  const fill = /<w:shd\b[^>]*\bw:fill=["']([^"']*)["']/i.exec(props)?.[1];
  return fill && HEX.test(fill) ? `#${fill.toUpperCase()}` : undefined;
}

export function parseRunStyle(runXml: string): DocumentTextStyle | undefined {
  const props = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(runXml)?.[1] ?? "";
  const font = /<w:rFonts\b[^>]*\bw:(?:ascii|hAnsi)=["']([^"']+)["']/i.exec(props)?.[1];
  const halfPoints = Number.parseFloat(val(props, "sz") ?? "");
  const color = val(props, "color");
  const shading = background(props);
  const baseline = val(props, "vertAlign");
  const style: DocumentTextStyle = {
    ...(enabled(props, "b") ? { bold: true } : {}),
    ...(enabled(props, "i") ? { italic: true } : {}),
    ...(enabled(props, "u") ? { underline: true } : {}),
    ...(enabled(props, "strike") ? { strike: true } : {}),
    ...(font ? { fontFamily: decodeXml(font) } : {}),
    ...(Number.isFinite(halfPoints) && halfPoints > 0 ? { fontSize: halfPoints / 2 } : {}),
    ...(color && HEX.test(color) ? { color: `#${color}` } : {}),
    ...(shading ? { background: shading } : {}),
    ...(baseline === "subscript" || baseline === "superscript" ? { verticalAlign: baseline } : {}),
  };
  return Object.keys(style).length ? style : undefined;
}

export function runStyleXml(style?: DocumentTextStyle): string {
  if (!style) return "";
  const hex = (value: string) => value.replace(/^#/, "").toUpperCase();
  const halfPoints = style.fontSize ? Math.round(style.fontSize * 2) : 0;
  return [
    style.fontFamily
      ? `<w:rFonts w:ascii="${encodeXml(style.fontFamily)}" w:hAnsi="${encodeXml(style.fontFamily)}"/>`
      : "",
    style.bold ? "<w:b/>" : "",
    style.italic ? "<w:i/>" : "",
    style.underline ? '<w:u w:val="single"/>' : "",
    style.strike ? "<w:strike/>" : "",
    style.color ? `<w:color w:val="${hex(style.color)}"/>` : "",
    halfPoints ? `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>` : "",
    style.background && HEX.test(hex(style.background))
      ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(style.background)}"/>`
      : "",
    style.verticalAlign ? `<w:vertAlign w:val="${style.verticalAlign}"/>` : "",
  ].join("");
}
