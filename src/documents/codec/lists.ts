// Word list numbering: which numbering instances are bullets and which are
// numbered, so an edited list paragraph keeps its kind and numbering.

import type { DocumentParagraph } from "../model";
import { val } from "./xml";

/** numId → list kind, from the file's own word/numbering.xml. */
export type ListKinds = ReadonlyMap<string, "bullet" | "number">;
export const NO_LISTS: ListKinds = new Map();

/** Which numbering instances are bullets and which are numbered (level 0's
 * numFmt), so a list keeps its kind whatever ids another app chose. */
export function listKinds(numberingXml: string): ListKinds {
  const abstract = new Map<string, "bullet" | "number">();
  for (const match of numberingXml.matchAll(
    /<w:abstractNum\b[^>]*\bw:abstractNumId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/w:abstractNum>/gi,
  )) {
    const level0 =
      /<w:lvl\b[^>]*\bw:ilvl=["']0["'][^>]*>([\s\S]*?)<\/w:lvl>/i.exec(match[2] ?? "")?.[1] ?? match[2] ?? "";
    abstract.set(match[1] ?? "", val(level0, "numFmt") === "bullet" ? "bullet" : "number");
  }
  const kinds = new Map<string, "bullet" | "number">();
  for (const match of numberingXml.matchAll(
    /<w:num\b[^>]*\bw:numId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/w:num>/gi,
  )) {
    const kind = abstract.get(val(match[2] ?? "", "abstractNumId") ?? "");
    if (match[1] && kind) kinds.set(match[1], kind);
  }
  return kinds;
}

/** A numbering id's kind: the file's own, else Rotli's (1 bullet, 2 numbered). */
export function listKindOf(numId: string | undefined, lists: ListKinds): "bullet" | "number" {
  return (numId && lists.get(numId)) || (numId === "2" ? "number" : "bullet");
}

/** A list paragraph's numbering: its original one while its kind holds (the
 * list keeps its numbering and level), else the file's own numbering of that
 * kind, else Rotli's (1 bullet, 2 numbered). */
export function listProps(list: DocumentParagraph["list"], originalProps: string, lists: ListKinds): string {
  if (!list) return "";
  const original = /<w:numPr\b[\s\S]*?<\/w:numPr>/i.exec(originalProps)?.[0];
  if (original && listKindOf(val(original, "numId"), lists) === list) return original;
  const id = [...lists].find(([, kind]) => kind === list)?.[0] ?? (list === "number" ? "2" : "1");
  return `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`;
}
