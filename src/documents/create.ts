import JSZip from "jszip";
import { DOCUMENT_CREATE_EXTENSION } from "./kinds";
import { blankDocumentDraft, type DocumentBlock, type DocumentDraft } from "./model";
import type { DocumentEncoder } from "./ports";
import { GENERATED_DOCX_THEME } from "./theme";

export type DocxBlock = DocumentBlock;
export type DocxTemplate = DocumentDraft;

function xml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraph(text: string, style?: string): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
  if (!rows.length) return "";
  const rule = GENERATED_DOCX_THEME.ruleColor;
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="${rule}"/><w:left w:val="single" w:sz="4" w:color="${rule}"/><w:bottom w:val="single" w:sz="4" w:color="${rule}"/><w:right w:val="single" w:sz="4" w:color="${rule}"/><w:insideH w:val="single" w:sz="4" w:color="${rule}"/><w:insideV w:val="single" w:sz="4" w:color="${rule}"/></w:tblBorders></w:tblPr>${rows
    .map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}<w:tcPr/></w:tc>`).join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

function documentXml(template: DocxTemplate): string {
  const content = [
    template.title ? paragraph(template.title, "Title") : "",
    template.subtitle ? paragraph(template.subtitle, "Subtitle") : "",
    ...(template.blocks ?? []).map((block) =>
      paragraph(block.text, block.kind === "heading" ? `Heading${block.level ?? 2}` : undefined),
    ),
    table(template.table ?? []),
  ].join("");
  const body = content || paragraph("");
  const theme = GENERATED_DOCX_THEME;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${theme.pageWidthTwips}" w:h="${theme.pageHeightTwips}"/><w:pgMar w:top="${theme.marginTwips}" w:right="${theme.marginTwips}" w:bottom="${theme.marginTwips}" w:left="${theme.marginTwips}"/></w:sectPr></w:body></w:document>`;
}

function runProperties(font: string, size: number, color: string, bold = false): string {
  return `<w:rPr><w:rFonts w:ascii="${xml(font)}" w:hAnsi="${xml(font)}" w:cs="${xml(font)}"/>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
}

function styleXml(): string {
  const theme = GENERATED_DOCX_THEME;
  const style = (
    id: string,
    name: string,
    font: string,
    size: number,
    color: string,
    options: { default?: boolean; bold?: boolean; spacingBefore?: number; spacingAfter?: number } = {},
  ) =>
    `<w:style w:type="paragraph"${options.default ? ' w:default="1"' : ""} w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : '<w:basedOn w:val="Normal"/>'}<w:pPr><w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${options.spacingAfter ?? 160}" w:line="276" w:lineRule="auto"/></w:pPr>${runProperties(font, size, color, options.bold)}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[
    style("Normal", "Normal", theme.bodyFont, theme.bodySizeHalfPoints, theme.bodyColor, { default: true }),
    style("Title", "Title", theme.headingFont, theme.titleSizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingAfter: 120,
    }),
    style("Subtitle", "Subtitle", theme.bodyFont, theme.subtitleSizeHalfPoints, theme.mutedColor, {
      spacingAfter: 280,
    }),
    style("Heading1", "heading 1", theme.headingFont, theme.heading1SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 300,
      spacingAfter: 120,
    }),
    style("Heading2", "heading 2", theme.headingFont, theme.heading2SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 260,
      spacingAfter: 100,
    }),
    style("Heading3", "heading 3", theme.headingFont, theme.heading3SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 220,
      spacingAfter: 80,
    }),
  ].join("")}</w:styles>`;
}

/** Build a small, standards-based DOCX locally. No network or office service. */
export async function createDocxBase64(template: DocxTemplate): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip
    .folder("_rels")
    ?.file(
      ".rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
  const word = zip.folder("word");
  word?.file("document.xml", documentXml(template));
  word
    ?.folder("_rels")
    ?.file(
      "document.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    );
  word?.file("styles.xml", styleXml());
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

export function blankDocumentTemplate(): DocxTemplate {
  return blankDocumentDraft();
}

export const docxEncoder: DocumentEncoder = {
  extension: DOCUMENT_CREATE_EXTENSION,
  encode: createDocxBase64,
};
