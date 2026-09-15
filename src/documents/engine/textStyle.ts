// Pure Univer ⇄ document-model style mappers for the document engine adapter.

import { BaselineOffset, HorizontalAlign, NamedStyleType, type ITextStyle } from "@univerjs/presets";

import type { DocumentAlignment, DocumentNamedStyle, DocumentTextStyle } from "../model";

export function namedStyle(value?: DocumentNamedStyle): NamedStyleType | undefined {
  if (value === "title") return NamedStyleType.TITLE;
  if (value === "subtitle") return NamedStyleType.SUBTITLE;
  if (value === "heading1") return NamedStyleType.HEADING_1;
  if (value === "heading2") return NamedStyleType.HEADING_2;
  if (value === "heading3") return NamedStyleType.HEADING_3;
  if (value === "normal") return NamedStyleType.NORMAL_TEXT;
  return undefined;
}

export function fromNamedStyle(value?: NamedStyleType): DocumentNamedStyle | undefined {
  if (value === NamedStyleType.TITLE) return "title";
  if (value === NamedStyleType.SUBTITLE) return "subtitle";
  if (value === NamedStyleType.HEADING_1) return "heading1";
  if (value === NamedStyleType.HEADING_2) return "heading2";
  if (value === NamedStyleType.HEADING_3) return "heading3";
  if (value === NamedStyleType.NORMAL_TEXT) return "normal";
  return undefined;
}

export function horizontalAlign(value?: DocumentAlignment): HorizontalAlign | undefined {
  if (value === "left") return HorizontalAlign.LEFT;
  if (value === "center") return HorizontalAlign.CENTER;
  if (value === "right") return HorizontalAlign.RIGHT;
  if (value === "justify") return HorizontalAlign.JUSTIFIED;
  return undefined;
}

export function fromHorizontalAlign(value?: HorizontalAlign): DocumentAlignment | undefined {
  if (value === HorizontalAlign.LEFT) return "left";
  if (value === HorizontalAlign.CENTER) return "center";
  if (value === HorizontalAlign.RIGHT) return "right";
  if (value === HorizontalAlign.JUSTIFIED || value === HorizontalAlign.BOTH) return "justify";
  return undefined;
}

export function textStyle(style?: DocumentTextStyle): ITextStyle | undefined {
  if (!style) return undefined;
  return {
    ...(style.fontFamily ? { ff: style.fontFamily } : {}),
    ...(style.fontSize ? { fs: style.fontSize } : {}),
    ...(style.bold ? { bl: 1 } : {}),
    ...(style.italic ? { it: 1 } : {}),
    ...(style.underline ? { ul: { s: 1 } } : {}),
    ...(style.strike ? { st: { s: 1 } } : {}),
    ...(style.color ? { cl: { rgb: style.color } } : {}),
    ...(style.background ? { bg: { rgb: style.background } } : {}),
    ...(style.verticalAlign
      ? { va: style.verticalAlign === "subscript" ? BaselineOffset.SUBSCRIPT : BaselineOffset.SUPERSCRIPT }
      : {}),
  };
}

export function fromTextStyle(style?: ITextStyle): DocumentTextStyle | undefined {
  if (!style) return undefined;
  const next: DocumentTextStyle = {
    ...(style.ff ? { fontFamily: style.ff } : {}),
    ...(style.fs ? { fontSize: style.fs } : {}),
    ...(style.bl ? { bold: true } : {}),
    ...(style.it ? { italic: true } : {}),
    ...(style.ul?.s ? { underline: true } : {}),
    ...(style.st?.s ? { strike: true } : {}),
    ...(style.cl?.rgb ? { color: style.cl.rgb } : {}),
    // Univer's "reset highlight" leaves bg: { rgb: null } rather than removing it.
    ...(style.bg?.rgb ? { background: style.bg.rgb } : {}),
    ...(style.va === BaselineOffset.SUBSCRIPT ? { verticalAlign: "subscript" as const } : {}),
    ...(style.va === BaselineOffset.SUPERSCRIPT ? { verticalAlign: "superscript" as const } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}
