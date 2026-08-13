import JSZip from "jszip";

import { DOCUMENT_CREATE_EXTENSION } from "./kinds";
import {
  blankDocumentDraft,
  type DocumentContent,
  type DocumentDraft,
  type DocumentImage,
  type DocumentParagraph,
  type DocumentRun,
  type DocumentTable,
} from "./model";
import type { DocumentEncoder } from "./ports";
import { GENERATED_DOCX_THEME } from "./theme";

export type DocxTemplate = DocumentDraft;

function xml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function run(run: DocumentRun, forceBold = false): string {
  const style = run.style;
  const props =
    style || forceBold
      ? `<w:rPr>${style?.fontFamily ? `<w:rFonts w:ascii="${xml(style.fontFamily)}" w:hAnsi="${xml(style.fontFamily)}"/>` : ""}${style?.fontSize ? `<w:sz w:val="${Math.round(style.fontSize * 2)}"/><w:szCs w:val="${Math.round(style.fontSize * 2)}"/>` : ""}${style?.color ? `<w:color w:val="${style.color.replace(/^#/, "")}"/>` : ""}${style?.bold || forceBold ? "<w:b/>" : ""}${style?.italic ? "<w:i/>" : ""}${style?.underline ? '<w:u w:val="single"/>' : ""}${style?.strike ? "<w:strike/>" : ""}</w:rPr>`
      : "";
  return `<w:r>${props}<w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`;
}

function paragraphFromModel(paragraph: DocumentParagraph, forceBold = false): string {
  const styleId =
    paragraph.namedStyle === "title"
      ? "Title"
      : paragraph.namedStyle === "subtitle"
        ? "Subtitle"
        : paragraph.namedStyle?.startsWith("heading")
          ? `Heading${paragraph.namedStyle.slice(-1)}`
          : undefined;
  const numId = paragraph.list === "number" ? 2 : paragraph.list === "bullet" ? 1 : undefined;
  const props = [
    styleId ? `<w:pStyle w:val="${styleId}"/>` : "",
    numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : "",
    paragraph.alignment
      ? `<w:jc w:val="${paragraph.alignment === "justify" ? "both" : paragraph.alignment}"/>`
      : "",
  ].join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${paragraph.runs.map((item) => run(item, forceBold)).join("") || run({ text: "" }, forceBold)}</w:p>`;
}

function paragraph(text: string, style?: string): string {
  return paragraphFromModel({
    runs: [{ text }],
    ...(style === "Title"
      ? { namedStyle: "title" as const }
      : style === "Subtitle"
        ? { namedStyle: "subtitle" as const }
        : style?.startsWith("Heading")
          ? { namedStyle: `heading${style.slice(-1)}` as "heading1" | "heading2" | "heading3" }
          : {}),
  });
}

function table(rows: string[][]): string {
  const modeled: DocumentTable = {
    id: "table",
    rows: rows.map((row) => ({
      cells: row.map((cell) => ({ paragraphs: [{ runs: [{ text: cell }] }] })),
    })),
  };
  return tableFromModel(modeled);
}

function tableFromModel(table: DocumentTable): string {
  if (!table.rows.length) return "";
  const theme = GENERATED_DOCX_THEME;
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="${theme.ruleColor}"/><w:left w:val="single" w:sz="4" w:color="${theme.ruleColor}"/><w:bottom w:val="single" w:sz="4" w:color="${theme.ruleColor}"/><w:right w:val="single" w:sz="4" w:color="${theme.ruleColor}"/><w:insideH w:val="single" w:sz="4" w:color="${theme.ruleColor}"/><w:insideV w:val="single" w:sz="4" w:color="${theme.ruleColor}"/></w:tblBorders>`;
  const cellMargins =
    '<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}${cellMargins}</w:tblPr>${table.rows
    .map(
      (row, rowIndex) =>
        `<w:tr>${row.cells
          .map(
            (cell) =>
              `<w:tc><w:tcPr>${rowIndex === 0 ? `<w:shd w:val="clear" w:fill="${theme.tableHeaderFill}"/>` : ""}</w:tcPr>${cell.paragraphs.map((item) => paragraphFromModel(item, rowIndex === 0)).join("") || paragraph("")}</w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("")}</w:tbl>`;
}

function imageExtension(image: DocumentImage): string {
  if (image.mimeType === "image/jpeg") return "jpg";
  if (image.mimeType === "image/gif") return "gif";
  if (image.mimeType === "image/bmp") return "bmp";
  return "png";
}

/** Standards-based inline DrawingML. The visual participates in document flow
 * and remains ordinary embedded media in Word, Pages, and LibreOffice. */
export function imageParagraphXml(image: DocumentImage, relationshipId: string, numericId = 1): string {
  const width = Math.max(1, Math.round(image.widthPx * 9525));
  const height = Math.max(1, Math.round(image.heightPx * 9525));
  const name = xml(image.name || `Image ${numericId}`);
  const alt = xml(image.alt ?? image.name ?? "");
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="240"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${numericId}" name="${name}" descr="${alt}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${numericId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function contentXml(content: DocumentContent): string {
  if (content.kind === "paragraph") return paragraphFromModel(content.paragraph);
  if (content.kind === "table") return tableFromModel(content.table);
  throw new Error("image content needs an OOXML relationship");
}

/** Generated visuals read as supporting evidence, not a cover-page spacer.
 * Keep the document title and introductory thought together, then place the
 * visual before the next section. */
function generatedImageInsertionIndex(content: readonly DocumentContent[]): number {
  const first = content[0];
  if (!first || first.kind !== "paragraph") return 0;
  if (!first.paragraph.namedStyle?.startsWith("heading")) return 1;

  const introduction = content[1];
  if (
    introduction?.kind === "paragraph" &&
    !introduction.paragraph.namedStyle?.startsWith("heading") &&
    !introduction.paragraph.list
  ) {
    return 2;
  }
  return 1;
}

function documentXml(template: DocxTemplate): string {
  const structured = template.content
    ? template.content.map(contentXml)
    : [
        ...(template.blocks ?? []).map((block) =>
          paragraph(block.text, block.kind === "heading" ? `Heading${block.level ?? 2}` : undefined),
        ),
        table(template.table ?? []),
      ];
  const images = (template.images ?? []).map((image, index) =>
    imageParagraphXml(image, `rIdImage${index + 1}`, index + 1),
  );
  const imageInsertionIndex = template.content
    ? generatedImageInsertionIndex(template.content)
    : Math.min(1, structured.length);
  const content = [
    template.title ? paragraph(template.title, "Title") : "",
    template.subtitle ? paragraph(template.subtitle, "Subtitle") : "",
    ...structured.slice(0, imageInsertionIndex),
    ...images,
    ...structured.slice(imageInsertionIndex),
  ].join("");
  const body = content || paragraph("");
  const theme = GENERATED_DOCX_THEME;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="${theme.pageWidthTwips}" w:h="${theme.pageHeightTwips}"/><w:pgMar w:top="${theme.marginTwips}" w:right="${theme.marginTwips}" w:bottom="${theme.marginTwips}" w:left="${theme.marginTwips}"/></w:sectPr></w:body></w:document>`;
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
    `<w:style w:type="paragraph"${options.default ? ' w:default="1"' : ""} w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : '<w:basedOn w:val="Normal"/>'}<w:pPr><w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${options.spacingAfter ?? 200}" w:line="${theme.lineSpacingTwips}" w:lineRule="auto"/></w:pPr>${runProperties(font, size, color, options.bold)}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[
    style("Normal", "Normal", theme.bodyFont, theme.bodySizeHalfPoints, theme.bodyColor, { default: true }),
    style("Title", "Title", theme.headingFont, theme.titleSizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingAfter: 220,
    }),
    style("Subtitle", "Subtitle", theme.bodyFont, theme.subtitleSizeHalfPoints, theme.mutedColor, {
      spacingAfter: 300,
    }),
    style("Heading1", "heading 1", theme.headingFont, theme.heading1SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 360,
      spacingAfter: 140,
    }),
    style("Heading2", "heading 2", theme.headingFont, theme.heading2SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 300,
      spacingAfter: 120,
    }),
    style("Heading3", "heading 3", theme.headingFont, theme.heading3SizeHalfPoints, theme.headingColor, {
      bold: true,
      spacingBefore: 260,
      spacingAfter: 100,
    }),
  ].join("")}</w:styles>`;
}

function numberingXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
}

/** Build a standards-based DOCX locally. No network or office service. */
export async function createDocxBase64(template: DocxTemplate): Promise<string> {
  const zip = new JSZip();
  const imageTypes = [
    ...new Map((template.images ?? []).map((image) => [imageExtension(image), image.mimeType])).entries(),
  ]
    .map(([extension, mime]) => `<Default Extension="${extension}" ContentType="${mime}"/>`)
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  );
  zip
    .folder("_rels")
    ?.file(
      ".rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
  const word = zip.folder("word");
  word?.file("document.xml", documentXml(template));
  const imageRelationships = (template.images ?? [])
    .map(
      (image, index) =>
        `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/rotli-image-${index + 1}.${imageExtension(image)}"/>`,
    )
    .join("");
  word
    ?.folder("_rels")
    ?.file(
      "document.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${imageRelationships}</Relationships>`,
    );
  word?.file("styles.xml", styleXml());
  word?.file("numbering.xml", numberingXml());
  const media = word?.folder("media");
  for (const [index, image] of (template.images ?? []).entries()) {
    media?.file(`rotli-image-${index + 1}.${imageExtension(image)}`, image.base64, { base64: true });
  }
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

export function blankDocumentTemplate(): DocxTemplate {
  return blankDocumentDraft();
}

export const docxEncoder: DocumentEncoder = {
  extension: DOCUMENT_CREATE_EXTENSION,
  encode: createDocxBase64,
};
