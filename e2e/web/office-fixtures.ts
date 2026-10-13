// Synthetic office packages for the Rotli Web office specs: real OOXML built
// with ExcelJS and JSZip in the test process, never a user's file.

import ExcelJS from "exceljs";
import JSZip from "jszip";

/** Two sheets, a formula, currency and percent formats. */
export async function budgetXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const budget = wb.addWorksheet("Budget");
  budget.addRow(["Item", "Cost"]);
  budget.addRow(["Synthetic paper", 12.5]);
  budget.addRow(["Synthetic ink", 7.25]);
  budget.getCell("A4").value = "Total";
  budget.getCell("B4").value = { formula: "SUM(B2:B3)", result: 19.75 };
  for (const row of [2, 3, 4]) budget.getCell(`B${row}`).numFmt = '"$"#,##0.00';
  const notes = wb.addWorksheet("Notes");
  notes.getCell("A1").value = "Second sheet marker";
  notes.getCell("B1").value = 0.375;
  notes.getCell("B1").numFmt = "0.0%";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function readXlsx(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return wb;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

/** A heading, a bold run, and a bordered 2×2 table. Stored uncompressed, so
 * two `lead` strings of the same length give two packages of the same size —
 * an outside edit no size check can see. */
export async function letterDocx(lead = "Plain text then "): Promise<Buffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Synthetic Heading</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">${lead}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>a bold run</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="4800" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
${row("Cell A1", "Cell B1")}${row("Cell A2", "Cell B2")}
</w:tbl>
<w:p><w:r><w:t>After the table.</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;
  const zip = new JSZip();
  // a fixed stamp keeps two builds byte-comparable apart from `lead`
  const date = new Date("2026-01-01T00:00:00Z");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    { date },
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    { date },
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    { date },
  );
  zip.file("word/document.xml", document, { date });
  zip.file("word/styles.xml", styles, { date });
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

/** A package part as text ("" when the part is missing). */
export async function packagePart(bytes: Buffer, part: string): Promise<string> {
  return (await (await JSZip.loadAsync(bytes)).file(part)?.async("string")) ?? "";
}
