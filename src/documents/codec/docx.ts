import JSZip from "jszip";

import { fileName } from "../../lib/fileKind";
import type {
  DocumentAlignment,
  DocumentContent,
  DocumentNamedStyle,
  DocumentParagraph,
  DocumentRun,
  DocumentTable,
  DocumentTableCell,
  DocumentTextStyle,
  EditableDocument,
} from "../model";
import type { DocumentEditorCodec } from "../ports";

type LayoutNode =
  | { kind: "paragraph"; xml: string; original: DocumentParagraph }
  | { kind: "table"; xml: string; original: DocumentTable }
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

function innerXml(xml: string, tag: string): string {
  return new RegExp(`<w:${tag}\\b[^>]*>([\\s\\S]*?)<\\/w:${tag}>`, "i").exec(xml)?.[1] ?? "";
}

function tableFromXml(xml: string, index: number): { table: DocumentTable; advancedParagraphs: number } {
  const grid = /<w:tblGrid\b[^>]*>([\s\S]*?)<\/w:tblGrid>/i.exec(xml)?.[1] ?? "";
  const columnWidths = [...grid.matchAll(/<w:gridCol\b[^>]*\bw:w=["'](\d+)["'][^>]*\/?\s*>/gi)]
    .map((match) => Number.parseInt(match[1] ?? "", 10) / 15)
    .filter((width) => Number.isFinite(width) && width > 0);
  let advancedParagraphs = 0;
  const rows = topLevelNodes(innerXml(xml, "tbl"))
    .filter((node) => /^<w:tr\b/i.test(node))
    .map((rowXml) => ({
      cells: topLevelNodes(innerXml(rowXml, "tr"))
        .filter((node) => /^<w:tc\b/i.test(node))
        .map((cellXml): DocumentTableCell => {
          const props = /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>|<w:tcPr\b[^>]*\/>/i.exec(cellXml)?.[1] ?? "";
          const gridSpan = Number.parseInt(val(props, "gridSpan") ?? "", 10);
          const merge = /<w:vMerge\b([^>]*)\/?\s*>/i.exec(props);
          const mergeValue = merge ? /\bw:val=["']([^"']+)["']/i.exec(merge[1] ?? "")?.[1] : undefined;
          const paragraphs = topLevelNodes(innerXml(cellXml, "tc"))
            .filter((node) => /^<w:p\b/i.test(node))
            .map((paragraphXml) => {
              if (
                /<w:(?:drawing|object|pict|fldChar|commentReference|bookmarkStart|sdt)\b/i.test(paragraphXml)
              ) {
                advancedParagraphs += 1;
              }
              return parseParagraph(paragraphXml);
            });
          return {
            paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }],
            ...(Number.isFinite(gridSpan) && gridSpan > 1 ? { columnSpan: gridSpan } : {}),
            ...(merge ? { rowSpan: mergeValue === "restart" ? 1 : 0 } : {}),
          };
        }),
    }));
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      if (row.cells[cellIndex]?.rowSpan !== 0) continue;
      for (let previous = rowIndex - 1; previous >= 0; previous -= 1) {
        const anchor = rows[previous]?.cells[cellIndex];
        if (!anchor) break;
        if (anchor.rowSpan === 0) continue;
        if (anchor.rowSpan === undefined) break;
        anchor.rowSpan += 1;
        break;
      }
    }
  }
  return {
    table: {
      id: `table-${index + 1}`,
      rows,
      ...(columnWidths.length ? { columnWidths } : {}),
    },
    advancedParagraphs,
  };
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
        style.fontSize
          ? `<w:sz w:val="${Math.round(style.fontSize * 2)}"/><w:szCs w:val="${Math.round(style.fontSize * 2)}"/>`
          : "",
      ].join("")
    : "";
  const pieces = run.text.split(/(\t|\n)/).map((piece) => {
    if (piece === "\t") return "<w:tab/>";
    if (piece === "\n") return "<w:br/>";
    return piece ? `<w:t xml:space="preserve">${encodeXml(piece)}</w:t>` : "";
  });
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${pieces.join("")}</w:r>`;
}

function preservedParagraphObjects(originalXml?: string): string {
  if (!originalXml) return "";
  return topLevelNodes(innerXml(originalXml, "p"))
    .filter(
      (node) =>
        !/^<w:pPr\b/i.test(node) &&
        /<w:(?:drawing|object|pict|fldChar|commentReference|bookmarkStart|bookmarkEnd|sdt)\b/i.test(node),
    )
    .join("");
}

function paragraphXml(paragraph: DocumentParagraph, originalXml?: string): string {
  const id = styleId(paragraph.namedStyle);
  const align = paragraphAlignment(paragraph.alignment);
  const props = [
    id ? `<w:pStyle w:val="${id}"/>` : "",
    align ? `<w:jc w:val="${align}"/>` : "",
    paragraph.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "",
  ].join("");
  const runs = paragraph.runs.length ? paragraph.runs : [{ text: "" }];
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs.map(runXml).join("")}${preservedParagraphObjects(originalXml)}</w:p>`;
}

function sameParagraph(left: DocumentParagraph, right: DocumentParagraph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cellProperties(cell: DocumentTableCell, originalXml?: string): string {
  const original =
    /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>|<w:tcPr\b[^>]*\/>/i.exec(originalXml ?? "")?.[1] ?? "";
  const retained = original
    .replace(/<w:gridSpan\b[^>]*\/?\s*>/gi, "")
    .replace(/<w:vMerge\b[^>]*\/?\s*>/gi, "");
  const owned = [
    cell.columnSpan && cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : "",
    cell.rowSpan === 0
      ? "<w:vMerge/>"
      : cell.rowSpan && cell.rowSpan > 1
        ? '<w:vMerge w:val="restart"/>'
        : "",
  ].join("");
  return retained || owned ? `<w:tcPr>${retained}${owned}</w:tcPr>` : "<w:tcPr/>";
}

function cellXml(cell: DocumentTableCell, originalXml?: string): string {
  if (!originalXml) {
    return `<w:tc>${cellProperties(cell)}${cell.paragraphs.map((paragraph) => paragraphXml(paragraph)).join("")}</w:tc>`;
  }
  const open = /^<w:tc\b[^>]*>/i.exec(originalXml)?.[0] ?? "<w:tc>";
  const children = topLevelNodes(innerXml(originalXml, "tc"));
  const next: string[] = [];
  let paragraphIndex = 0;
  let sawProperties = false;
  for (const child of children) {
    if (/^<w:tcPr\b/i.test(child)) {
      next.push(cellProperties(cell, child));
      sawProperties = true;
    } else if (/^<w:p\b/i.test(child)) {
      const paragraph = cell.paragraphs[paragraphIndex++];
      if (paragraph) next.push(paragraphXml(paragraph, child));
    } else {
      next.push(child);
    }
  }
  if (!sawProperties) next.unshift(cellProperties(cell));
  while (paragraphIndex < cell.paragraphs.length) next.push(paragraphXml(cell.paragraphs[paragraphIndex++]!));
  if (!cell.paragraphs.length) next.push(paragraphXml({ runs: [{ text: "" }] }));
  return `${open}${next.join("")}</w:tc>`;
}

function rowXml(cells: DocumentTableCell[], originalXml?: string): string {
  if (!originalXml) return `<w:tr>${cells.map((cell) => cellXml(cell)).join("")}</w:tr>`;
  const open = /^<w:tr\b[^>]*>/i.exec(originalXml)?.[0] ?? "<w:tr>";
  const next: string[] = [];
  let cellIndex = 0;
  for (const child of topLevelNodes(innerXml(originalXml, "tr"))) {
    if (/^<w:tc\b/i.test(child)) {
      const cell = cells[cellIndex++];
      if (cell) next.push(cellXml(cell, child));
    } else {
      next.push(child);
    }
  }
  while (cellIndex < cells.length) next.push(cellXml(cells[cellIndex++]!));
  return `${open}${next.join("")}</w:tr>`;
}

function tableXml(table: DocumentTable, originalXml?: string): string {
  if (!originalXml) return `<w:tbl>${table.rows.map((row) => rowXml(row.cells)).join("")}</w:tbl>`;
  const open = /^<w:tbl\b[^>]*>/i.exec(originalXml)?.[0] ?? "<w:tbl>";
  const next: string[] = [];
  let rowIndex = 0;
  let sawGrid = false;
  for (const child of topLevelNodes(innerXml(originalXml, "tbl"))) {
    if (/^<w:tblGrid\b/i.test(child) && table.columnWidths?.length) {
      next.push(
        `<w:tblGrid>${table.columnWidths.map((width) => `<w:gridCol w:w="${Math.max(1, Math.round(width * 15))}"/>`).join("")}</w:tblGrid>`,
      );
      sawGrid = true;
    } else if (/^<w:tr\b/i.test(child)) {
      const row = table.rows[rowIndex++];
      if (row) next.push(rowXml(row.cells, child));
    } else {
      next.push(child);
      if (/^<w:tblGrid\b/i.test(child)) sawGrid = true;
    }
  }
  if (!sawGrid && table.columnWidths?.length) {
    const at = next.findIndex((child) => !/^<w:tblPr\b/i.test(child));
    const grid = `<w:tblGrid>${table.columnWidths.map((width) => `<w:gridCol w:w="${Math.max(1, Math.round(width * 15))}"/>`).join("")}</w:tblGrid>`;
    next.splice(at < 0 ? next.length : at, 0, grid);
  }
  while (rowIndex < table.rows.length) next.push(rowXml(table.rows[rowIndex++]!.cells));
  return `${open}${next.join("")}</w:tbl>`;
}

function contentXml(content: DocumentContent, template?: LayoutNode): string {
  if (content.kind === "paragraph") {
    if (template?.kind === "paragraph" && sameParagraph(content.paragraph, template.original))
      return template.xml;
    return paragraphXml(content.paragraph, template?.kind === "paragraph" ? template.xml : undefined);
  }
  if (template?.kind === "table" && JSON.stringify(content.table) === JSON.stringify(template.original))
    return template.xml;
  return tableXml(content.table, template?.kind === "table" ? template.xml : undefined);
}

export async function decodeDocx(
  base64: string,
  fileId: string,
): Promise<{
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
  const content: DocumentContent[] = [];
  const layout: LayoutNode[] = [];
  const warnings: string[] = [];
  let advancedParagraphs = 0;
  let tableIndex = 0;
  for (const child of children) {
    if (/^<w:p\b/i.test(child)) {
      const paragraph = parseParagraph(child);
      content.push({ kind: "paragraph", paragraph });
      layout.push({ kind: "paragraph", xml: child, original: paragraph });
      if (/<w:(?:drawing|object|fldChar|commentReference|bookmarkStart|sdt)\b/i.test(child)) {
        advancedParagraphs += 1;
      }
    } else if (/^<w:tbl\b/i.test(child)) {
      const parsed = tableFromXml(child, tableIndex++);
      content.push({ kind: "table", table: parsed.table });
      layout.push({ kind: "table", xml: child, original: structuredClone(parsed.table) });
      advancedParagraphs += parsed.advancedParagraphs;
    } else {
      layout.push({ kind: "opaque", xml: child });
    }
  }
  if (advancedParagraphs) {
    warnings.push(
      `${advancedParagraphs} paragraph${advancedParagraphs === 1 ? " contains" : "s contain"} unsupported Word objects that remain preserved`,
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
      content: content.length ? content : [{ kind: "paragraph", paragraph: { runs: [{ text: "" }] } }],
    },
    warnings,
  };
}

export async function encodeDocx(source: DocxSource, document: EditableDocument): Promise<string> {
  const edited = [...document.content];
  const children: string[] = [];
  let contentIndex = 0;
  let insertedExtras = false;
  const sourceTableIds = new Set(
    source.layout.flatMap((node) => (node.kind === "table" ? [node.original.id] : [])),
  );
  for (const node of source.layout) {
    if (node.kind === "paragraph") {
      // A newly inserted table can sit before an original paragraph. Emit it
      // without consuming the paragraph template; a table id already present
      // in the source belongs to its own later layout node.
      while (edited[contentIndex]?.kind === "table") {
        const insertedTable = edited[contentIndex];
        if (!insertedTable || insertedTable.kind !== "table" || sourceTableIds.has(insertedTable.table.id))
          break;
        children.push(contentXml(edited[contentIndex++]!));
      }
      const content = edited[contentIndex++];
      if (content?.kind === "paragraph") children.push(contentXml(content, node));
      else if (content) contentIndex -= 1;
      continue;
    }
    if (node.kind === "table") {
      const matchIndex = edited.findIndex(
        (content, index) =>
          index >= contentIndex && content.kind === "table" && content.table.id === node.original.id,
      );
      if (matchIndex < 0) continue;
      while (contentIndex < matchIndex) children.push(contentXml(edited[contentIndex++]!));
      children.push(contentXml(edited[contentIndex++]!, node));
      continue;
    }
    // New paragraphs belong before final section properties, never after them.
    if (!insertedExtras && /^<w:sectPr\b/i.test(node.xml)) {
      while (contentIndex < edited.length) children.push(contentXml(edited[contentIndex++]!));
      insertedExtras = true;
    }
    children.push(node.xml);
  }
  while (contentIndex < edited.length) children.push(contentXml(edited[contentIndex++]!));
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
