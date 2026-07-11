import JSZip from "jszip";
import { fileName } from "../../lib/fileKind";
import type {
  DocumentAlignment,
  DocumentNamedStyle,
  DocumentParagraph,
  DocumentRun,
  DocumentTextStyle,
  EditableDocument,
} from "../model";
import type { DocumentEditorCodec } from "../ports";

type LayoutNode =
  | { kind: "paragraph"; xml: string; original: DocumentParagraph }
  | { kind: "opaque"; xml: string };

export interface DocxSource {
  zip: JSZip;
  documentXml: string;
  bodyOpen: string;
  bodyClose: string;
  layout: LayoutNode[];
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function encodeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function val(xml: string, tag: string): string | undefined {
  return new RegExp(`<w:${tag}\\b[^>]*\\bw:val=["']([^"']*)["'][^>]*\\/?>`, "i").exec(xml)?.[1];
}

function enabled(xml: string, tag: string): boolean {
  const match = new RegExp(`<w:${tag}\\b([^>]*)\\/?>`, "i").exec(xml);
  if (!match) return false;
  return !/\bw:val=["'](?:0|false|off|none)["']/i.test(match[1] ?? "");
}

function parseStyle(runXml: string): DocumentTextStyle | undefined {
  const props = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(runXml)?.[1] ?? "";
  const font = /<w:rFonts\b[^>]*\bw:(?:ascii|hAnsi)=["']([^"']+)["']/i.exec(props)?.[1];
  const halfPoints = Number.parseFloat(val(props, "sz") ?? "");
  const color = val(props, "color");
  const style: DocumentTextStyle = {
    ...(enabled(props, "b") ? { bold: true } : {}),
    ...(enabled(props, "i") ? { italic: true } : {}),
    ...(enabled(props, "u") ? { underline: true } : {}),
    ...(enabled(props, "strike") ? { strike: true } : {}),
    ...(font ? { fontFamily: decodeXml(font) } : {}),
    ...(Number.isFinite(halfPoints) && halfPoints > 0 ? { fontSize: halfPoints / 2 } : {}),
    ...(color && /^[0-9a-f]{6}$/i.test(color) ? { color: `#${color}` } : {}),
  };
  return Object.keys(style).length ? style : undefined;
}

function parseRun(runXml: string): DocumentRun {
  let text = "";
  const tokens = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?\s*>|<w:br\b[^>]*\/?\s*>/gi;
  for (const match of runXml.matchAll(tokens)) {
    text += match[1] !== undefined ? decodeXml(match[1]) : match[0].startsWith("<w:tab") ? "\t" : "\n";
  }
  const style = parseStyle(runXml);
  return { text, ...(style ? { style } : {}) };
}

function namedStyle(styleId?: string): DocumentNamedStyle | undefined {
  const key = styleId?.toLowerCase().replace(/[\s_-]/g, "");
  if (key === "title") return "title";
  if (key === "subtitle") return "subtitle";
  if (key === "heading1") return "heading1";
  if (key === "heading2") return "heading2";
  if (key === "heading3") return "heading3";
  return undefined;
}

function alignment(value?: string): DocumentAlignment | undefined {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  if (value === "left" || value === "start") return "left";
  return undefined;
}

function parseParagraph(xml: string): DocumentParagraph {
  const props = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/i.exec(xml)?.[1] ?? "";
  const runs = [...xml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/gi)]
    .map((match) => parseRun(match[0]))
    .filter((run) => run.text.length > 0);
  const paragraphStyle = namedStyle(val(props, "pStyle"));
  const paragraphAlignment = alignment(val(props, "jc"));
  return {
    runs: runs.length ? runs : [{ text: "" }],
    ...(paragraphStyle ? { namedStyle: paragraphStyle } : {}),
    ...(paragraphAlignment ? { alignment: paragraphAlignment } : {}),
    ...(/<w:numPr\b/i.test(props) ? { list: "bullet" as const } : {}),
  };
}

/** Split the body into direct children, so paragraphs can change while tables,
 * drawings, content controls, and section properties remain byte-for-byte. */
function topLevelNodes(body: string): string[] {
  const nodes: string[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);
    if (start < 0) break;
    if (body.startsWith("<!--", start)) {
      const end = body.indexOf("-->", start + 4);
      if (end < 0) break;
      nodes.push(body.slice(start, end + 3));
      cursor = end + 3;
      continue;
    }
    const open = /^<([\w:-]+)\b[^>]*>/i.exec(body.slice(start));
    if (!open) {
      cursor = start + 1;
      continue;
    }
    const tag = open[1];
    const openText = open[0];
    if (!tag) break;
    if (/\/\s*>$/.test(openText)) {
      nodes.push(openText);
      cursor = start + openText.length;
      continue;
    }
    const token = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, "gi");
    token.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (;;) {
      const match = token.exec(body);
      if (!match) break;
      if (match[0].startsWith("</")) depth -= 1;
      else if (!/\/\s*>$/.test(match[0])) depth += 1;
      if (depth === 0) {
        end = token.lastIndex;
        break;
      }
    }
    if (end < 0) break;
    nodes.push(body.slice(start, end));
    cursor = end;
  }
  return nodes;
}

function styleId(style?: DocumentNamedStyle): string | undefined {
  if (style === "title") return "Title";
  if (style === "subtitle") return "Subtitle";
  if (style === "heading1") return "Heading1";
  if (style === "heading2") return "Heading2";
  if (style === "heading3") return "Heading3";
  return undefined;
}

function paragraphAlignment(value?: DocumentAlignment): string | undefined {
  if (value === "justify") return "both";
  return value;
}

function runXml(run: DocumentRun): string {
  const style = run.style;
  const props = style
    ? [
        style.fontFamily
          ? `<w:rFonts w:ascii="${encodeXml(style.fontFamily)}" w:hAnsi="${encodeXml(style.fontFamily)}"/>`
          : "",
        style.bold ? "<w:b/>" : "",
        style.italic ? "<w:i/>" : "",
        style.underline ? '<w:u w:val="single"/>' : "",
        style.strike ? "<w:strike/>" : "",
        style.color ? `<w:color w:val="${style.color.replace(/^#/, "").toUpperCase()}"/>` : "",
        style.fontSize ? `<w:sz w:val="${Math.round(style.fontSize * 2)}"/><w:szCs w:val="${Math.round(style.fontSize * 2)}"/>` : "",
      ].join("")
    : "";
  const pieces = run.text.split(/(\t|\n)/).map((piece) => {
    if (piece === "\t") return "<w:tab/>";
    if (piece === "\n") return "<w:br/>";
    return piece ? `<w:t xml:space="preserve">${encodeXml(piece)}</w:t>` : "";
  });
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${pieces.join("")}</w:r>`;
}

function paragraphXml(paragraph: DocumentParagraph): string {
  const id = styleId(paragraph.namedStyle);
  const align = paragraphAlignment(paragraph.alignment);
  const props = [
    id ? `<w:pStyle w:val="${id}"/>` : "",
    align ? `<w:jc w:val="${align}"/>` : "",
    paragraph.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "",
  ].join("");
  const runs = paragraph.runs.length ? paragraph.runs : [{ text: "" }];
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs.map(runXml).join("")}</w:p>`;
}

function sameParagraph(left: DocumentParagraph, right: DocumentParagraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function decodeDocx(base64: string, fileId: string): Promise<{
  source: DocxSource;
  document: EditableDocument;
  warnings: string[];
}> {
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("This DOCX has no editable Word document body");
  const body = /(<w:body\b[^>]*>)([\s\S]*?)(<\/w:body>)/i.exec(documentXml);
  if (!body) throw new Error("This DOCX has an unreadable Word document body");
  const children = topLevelNodes(body[2] ?? "");
  const paragraphs: DocumentParagraph[] = [];
  const layout: LayoutNode[] = [];
  const warnings: string[] = [];
  let advancedParagraphs = 0;
  let tables = 0;
  for (const child of children) {
    if (/^<w:p\b/i.test(child)) {
      const paragraph = parseParagraph(child);
      paragraphs.push(paragraph);
      layout.push({ kind: "paragraph", xml: child, original: paragraph });
      if (/<w:(?:drawing|object|fldChar|commentReference|bookmarkStart|sdt)\b/i.test(child)) {
        advancedParagraphs += 1;
      }
    } else {
      if (/^<w:tbl\b/i.test(child)) tables += 1;
      layout.push({ kind: "opaque", xml: child });
    }
  }
  if (tables) warnings.push(`${tables} table${tables === 1 ? " is" : "s are"} preserved but not editable yet`);
  if (advancedParagraphs) {
    warnings.push(
      `${advancedParagraphs} paragraph${advancedParagraphs === 1 ? " contains" : "s contain"} advanced Word objects that stay in the backup`,
    );
  }
  return {
    source: {
      zip,
      documentXml,
      bodyOpen: body[1] ?? "<w:body>",
      bodyClose: body[3] ?? "</w:body>",
      layout,
    },
    document: {
      id: fileId,
      title: fileName(fileId).replace(/\.[^.]+$/, ""),
      paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }],
    },
    warnings,
  };
}

export async function encodeDocx(source: DocxSource, document: EditableDocument): Promise<string> {
  const edited = [...document.paragraphs];
  const children: string[] = [];
  let paragraphIndex = 0;
  let insertedExtras = false;
  for (const node of source.layout) {
    if (node.kind === "paragraph") {
      const paragraph = edited[paragraphIndex++];
      if (paragraph) {
        children.push(sameParagraph(paragraph, node.original) ? node.xml : paragraphXml(paragraph));
      }
      continue;
    }
    // New paragraphs belong before final section properties, never after them.
    if (!insertedExtras && /^<w:sectPr\b/i.test(node.xml)) {
      while (paragraphIndex < edited.length) children.push(paragraphXml(edited[paragraphIndex++]!));
      insertedExtras = true;
    }
    children.push(node.xml);
  }
  while (paragraphIndex < edited.length) children.push(paragraphXml(edited[paragraphIndex++]!));
  if (!edited.length) children.unshift(paragraphXml({ runs: [{ text: "" }] }));
  const bodyPattern = /<w:body\b[^>]*>[\s\S]*?<\/w:body>/i;
  const nextXml = source.documentXml.replace(
    bodyPattern,
    `${source.bodyOpen}${children.join("")}${source.bodyClose}`,
  );
  source.zip.file("word/document.xml", nextXml);
  return source.zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

export const docxEditorCodec: DocumentEditorCodec<DocxSource> = {
  decode: decodeDocx,
  encode: encodeDocx,
};
