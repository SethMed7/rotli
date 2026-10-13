import type { DocumentAlignment, DocumentNamedStyle } from "../model";

export function namedStyle(styleId?: string): DocumentNamedStyle | undefined {
  const key = styleId?.toLowerCase().replace(/[\s_-]/g, "");
  if (key === "title") return "title";
  if (key === "subtitle") return "subtitle";
  if (key === "heading1") return "heading1";
  if (key === "heading2") return "heading2";
  if (key === "heading3") return "heading3";
  return undefined;
}

export function alignment(value?: string): DocumentAlignment | undefined {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  if (value === "left" || value === "start") return "left";
  return undefined;
}
