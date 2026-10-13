// Ordinary Office packages for the Rust secure local-read regression, written
// by the real ExcelJS and Rotli DOCX writers. The bytes are committed under
// fixtures/office-ledger/ (CI's Rust job has no Bun); regenerate them with
//   bun src-tauri/fixtures/office-ledger-packages.ts src-tauri/fixtures/office-ledger
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { createDocxBase64 } from "../../src/documents/create";

const output = process.argv[2];
if (!output) throw new Error("expected an output directory");
await mkdir(output, { recursive: true });

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=";
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet("Field notes");
sheet.getCell("A1").value = {
  text: "The amber garden itinerary changes before the final snowfall.",
  hyperlink: "https://example.com/private/indigo-harbor-meeting-next-thursday",
};
await book.xlsx.writeFile(join(output, "hyperlink.xlsx"));

sheet.getCell("B2").value = "Commented cell";
sheet.getCell("B2").note = "The violet orchard comment stays inside the local workbook.";
await book.xlsx.writeFile(join(output, "hyperlink-comment.xlsx"));

const imageId = book.addImage({ base64: png, extension: "png" });
sheet.addImage(imageId, "D2:E4");
await book.xlsx.writeFile(join(output, "hyperlink-comment-image.xlsx"));

const base64 = await createDocxBase64({
  title: "Field notes",
  content: [
    {
      kind: "paragraph",
      paragraph: {
        runs: [
          {
            text: "The silver lighthouse guide waits beyond the autumn tide.",
            link: "https://example.com/private/silver-lighthouse-guide-autumn-tide",
          },
        ],
      },
    },
  ],
  images: [
    {
      id: "field-map",
      name: "Field map",
      alt: "The saffron observatory appointment moves before next winter.",
      mimeType: "image/png",
      base64: png,
      widthPx: 1,
      heightPx: 1,
    },
  ],
});
const zip = await JSZip.loadAsync(base64, { base64: true });
const document = await zip.file("word/document.xml")!.async("string");
zip.file(
  "word/document.xml",
  document.replace("<w:sectPr>", '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/>'),
);
const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
zip.file(
  "word/_rels/document.xml.rels",
  rels.replace(
    "</Relationships>",
    '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
  ),
);
zip.file(
  "word/header1.xml",
  '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>The indigo harbor header remains inside the private document.</w:t></w:r></w:p></w:hdr>',
);
const types = await zip.file("[Content_Types].xml")!.async("string");
zip.file(
  "[Content_Types].xml",
  types.replace(
    "</Types>",
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
  ),
);
await Bun.write(join(output, "image-hyperlink-header.docx"), await zip.generateAsync({ type: "uint8array" }));
