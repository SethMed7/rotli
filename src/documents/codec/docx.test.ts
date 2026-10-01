import { describe, expect, test } from "bun:test";

import JSZip from "jszip";

import { createDocxBase64 } from "../create";
import type { EditableDocument } from "../model";
import { decodeDocx, encodeDocx } from "./docx";

// Document fixture colors (OOXML hex without the leading #), not UI colors.
const ORANGE = "F6B26B";
const RED = "FF0000";
const YELLOW = "FFFF00";

describe("DOCX editor codec", () => {
  const RED_PIXEL_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=";

  test("round-trips edited paragraphs without rewriting opaque package parts", async () => {
    const base64 = await createDocxBase64({
      title: "Original title",
      subtitle: "Local document",
      blocks: [{ kind: "paragraph", text: "Editable body" }],
      table: [
        ["Owner", "Status"],
        ["Rotli", "Preserved"],
      ],
    });
    const originalZip = await JSZip.loadAsync(base64, { base64: true });
    const originalStyles = await originalZip.file("word/styles.xml")?.async("string");

    const decoded = await decodeDocx(base64, "storage/rotli/plan.docx");
    decoded.document.content[0] = {
      kind: "paragraph",
      paragraph: {
        runs: [{ text: "Edited in Rotli", style: { bold: true, fontFamily: "Aptos", fontSize: 18 } }],
        namedStyle: "title",
      },
    };
    const table = decoded.document.content.find((content) => content.kind === "table");
    if (!table || table.kind !== "table") throw new Error("expected editable table");
    table.table.rows[1]!.cells[1]!.paragraphs[0]!.runs = [{ text: "Edited table" }];
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const savedZip = await JSZip.loadAsync(encoded, { base64: true });
    const savedDocument = await savedZip.file("word/document.xml")?.async("string");
    const savedStyles = await savedZip.file("word/styles.xml")?.async("string");

    expect(savedDocument).toContain("Edited in Rotli");
    expect(savedDocument).toContain('w:ascii="Aptos"');
    expect(savedDocument).toContain("<w:b/>");
    expect(savedDocument).toContain("<w:tbl>");
    expect(savedDocument).toContain("Edited table");
    expect(savedStyles).toBe(originalStyles);

    const reopened = await decodeDocx(encoded, "storage/rotli/plan.docx");
    expect(reopened.document.content[0]?.kind).toBe("paragraph");
    const reopenedTitle = reopened.document.content[0];
    expect(reopenedTitle?.kind === "paragraph" ? reopenedTitle.paragraph.runs[0] : undefined).toEqual({
      text: "Edited in Rotli",
      style: { bold: true, fontFamily: "Aptos", fontSize: 18 },
    });
    const reopenedTable = reopened.document.content.find((content) => content.kind === "table");
    expect(
      reopenedTable?.kind === "table"
        ? reopenedTable.table.rows[1]?.cells[1]?.paragraphs[0]?.runs[0]?.text
        : undefined,
    ).toBe("Edited table");
  });

  test("round-trips background shading and sub/superscript runs", async () => {
    const base64 = await createDocxBase64({ title: "", blocks: [{ kind: "paragraph", text: "Body" }] });
    const decoded = await decodeDocx(base64, "storage/rotli/marks.docx");
    const runs = [
      { text: "shaded", style: { background: `#${ORANGE}` } },
      { text: "2", style: { verticalAlign: "subscript" as const } },
      { text: "th", style: { verticalAlign: "superscript" as const, color: `#${RED}` } },
    ];
    decoded.document.content = [{ kind: "paragraph", paragraph: { runs } }];
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await JSZip.loadAsync(encoded, { base64: true });
    const savedXml = (await saved.file("word/document.xml")?.async("string")) ?? "";
    expect(savedXml).toContain(`<w:shd w:val="clear" w:color="auto" w:fill="${ORANGE}"/>`);
    expect(savedXml).toContain('<w:vertAlign w:val="subscript"/>');

    const reopened = await decodeDocx(encoded, "storage/rotli/marks.docx");
    const paragraph = reopened.document.content[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.paragraph.runs : undefined).toEqual([
      { text: "shaded", style: { background: `#${ORANGE}` } },
      { text: "2", style: { verticalAlign: "subscript" } },
      { text: "th", style: { color: `#${RED}`, verticalAlign: "superscript" } },
    ]);
  });

  test("reads Word highlight colors and drops them when the run loses its background", async () => {
    const base64 = await createDocxBase64({ title: "", blocks: [{ kind: "paragraph", text: "Marked" }] });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    zip.file(
      "word/document.xml",
      xml.replace(
        '<w:r><w:t xml:space="preserve">Marked</w:t></w:r>',
        '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">Marked</w:t></w:r>',
      ),
    );
    const decoded = await decodeDocx(await zip.generateAsync({ type: "base64" }), "storage/rotli/hl.docx");
    const index = decoded.document.content.findIndex(
      (content) => content.kind === "paragraph" && content.paragraph.runs[0]?.text === "Marked",
    );
    const marked = decoded.document.content[index];
    if (!marked || marked.kind !== "paragraph") throw new Error("expected highlighted paragraph");
    expect(marked.paragraph.runs[0]?.style).toEqual({ background: `#${YELLOW}` });

    marked.paragraph.runs = [{ text: "Marked" }];
    const saved = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), { base64: true });
    const savedXml = (await saved.file("word/document.xml")?.async("string")) ?? "";
    expect(savedXml).toContain("Marked");
    expect(savedXml).not.toContain("w:highlight");
  });

  test("decodes Word tables as native editable document content", async () => {
    const base64 = await createDocxBase64({ title: "Table", table: [["A", "B"]] });
    const decoded = await decodeDocx(base64, "storage/rotli/table.docx");
    expect(decoded.warnings).toEqual([]);
    expect(decoded.document.content).toEqual([
      { kind: "paragraph", paragraph: { runs: [{ text: "Table" }], namedStyle: "title" } },
      {
        kind: "table",
        table: {
          id: "table-1",
          rows: [
            {
              cells: [
                { paragraphs: [{ runs: [{ text: "A", style: { bold: true } }] }] },
                { paragraphs: [{ runs: [{ text: "B", style: { bold: true } }] }] },
              ],
            },
          ],
        },
      },
    ]);
  });

  test("keeps an untouched advanced paragraph byte-for-byte when another paragraph changes", async () => {
    const base64 = await createDocxBase64({
      title: "Editable title",
      blocks: [{ kind: "paragraph", text: "Paragraph with drawing" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const advanced = '<w:r><w:drawing><wp:inline xmlns:wp="urn:test"/></w:drawing></w:r>';
    zip.file(
      "word/document.xml",
      xml.replace("Paragraph with drawing</w:t></w:r>", `Paragraph with drawing</w:t></w:r>${advanced}`),
    );
    const withDrawing = await zip.generateAsync({ type: "base64" });

    const decoded = await decodeDocx(withDrawing, "storage/rotli/drawing.docx");
    decoded.document.content[0] = {
      kind: "paragraph",
      paragraph: { runs: [{ text: "Changed title" }], namedStyle: "title" },
    };
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await JSZip.loadAsync(encoded, { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");

    expect(savedXml).toContain("Changed title");
    expect(savedXml).toContain(advanced);
  });

  test("preserves unsupported objects inside a table cell when its text changes", async () => {
    const base64 = await createDocxBase64({ title: "", table: [["Cell text"]] });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const object = '<w:r><w:object><w:control xmlns:w="urn:test"/></w:object></w:r>';
    zip.file("word/document.xml", xml.replace("Cell text</w:t></w:r>", `Cell text</w:t></w:r>${object}`));
    const withObject = await zip.generateAsync({ type: "base64" });

    const decoded = await decodeDocx(withObject, "storage/rotli/object.docx");
    const table = decoded.document.content.find((content) => content.kind === "table");
    if (!table || table.kind !== "table") throw new Error("expected table");
    table.table.rows[0]!.cells[0]!.paragraphs[0]!.runs = [{ text: "Changed cell" }];
    const saved = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");

    expect(savedXml).toContain("Changed cell");
    expect(savedXml).toContain(object);
  });

  test("refuses to rewrite a changed in-document link paragraph instead of silently dropping its target", async () => {
    const base64 = await createDocxBase64({
      title: "Links",
      blocks: [{ kind: "paragraph", text: "Linked text" }],
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    zip.file(
      "word/document.xml",
      xml.replace(
        '<w:r><w:t xml:space="preserve">Linked text</w:t></w:r>',
        '<w:hyperlink w:anchor="_Top"><w:r><w:t xml:space="preserve">Linked text</w:t></w:r></w:hyperlink>',
      ),
    );
    const linked = await zip.generateAsync({ type: "base64" });
    const decoded = await decodeDocx(linked, "storage/rotli/links.docx");
    const paragraph = decoded.document.content.find(
      (content) =>
        content.kind === "paragraph" && content.paragraph.runs.some((run) => run.text === "Linked text"),
    );
    if (!paragraph || paragraph.kind !== "paragraph") throw new Error("expected hyperlink paragraph");
    paragraph.paragraph.runs = [{ text: "Changed link label" }];

    await expect(encodeDocx(decoded.source, decoded.document)).rejects.toThrow(/unsupported Word inline/i);
  });

  test("keeps an original table template when a new table is inserted before it", async () => {
    const base64 = await createDocxBase64({ title: "", table: [["Original"]] });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("fixture has no document.xml");
    const object = '<w:r><w:object><w:control xmlns:w="urn:test"/></w:object></w:r>';
    zip.file("word/document.xml", xml.replace("Original</w:t></w:r>", `Original</w:t></w:r>${object}`));
    const decoded = await decodeDocx(
      await zip.generateAsync({ type: "base64" }),
      "storage/rotli/insert.docx",
    );
    decoded.document.content.unshift({
      kind: "table",
      table: {
        id: "new-table",
        rows: [{ cells: [{ paragraphs: [{ runs: [{ text: "New" }] }] }] }],
      },
    });

    const saved = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");
    expect(savedXml?.indexOf("New")).toBeLessThan(savedXml?.indexOf("Original") ?? -1);
    expect(savedXml).toContain(object);
  });

  test("round-trips resized and newly inserted images as conventional DOCX media", async () => {
    const base64 = await createDocxBase64({
      title: "Visual",
      images: [
        {
          id: "source-image",
          name: "Source",
          mimeType: "image/png",
          base64: RED_PIXEL_PNG,
          widthPx: 120,
          heightPx: 80,
        },
      ],
    });
    const decoded = await decodeDocx(base64, "storage/rotli/visual.docx");
    const image = decoded.document.content.find((content) => content.kind === "image");
    if (!image || image.kind !== "image") throw new Error("expected embedded image");
    image.image.widthPx = 240;
    image.image.heightPx = 160;
    decoded.document.content.push({
      kind: "image",
      image: {
        id: "new-image",
        name: "New image",
        mimeType: "image/png",
        base64: RED_PIXEL_PNG,
        widthPx: 320,
        heightPx: 180,
      },
    });

    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await JSZip.loadAsync(encoded, { base64: true });
    const savedXml = await saved.file("word/document.xml")?.async("string");
    const relationships = await saved.file("word/_rels/document.xml.rels")?.async("string");
    expect(savedXml).toContain('wp:extent cx="2286000" cy="1524000"');
    expect(savedXml).toContain('name="New image"');
    expect(relationships).toContain("relationships/image");
    expect(saved.file(/word\/media\/rotli-inserted-image-\d+\.png/)).toHaveLength(1);

    const reopened = await decodeDocx(encoded, "storage/rotli/visual.docx");
    const images = reopened.document.content.filter((content) => content.kind === "image");
    expect(images).toHaveLength(2);
    expect(images.map((content) => (content.kind === "image" ? content.image.widthPx : 0))).toEqual([
      240, 320,
    ]);

    const secondSave = await JSZip.loadAsync(await encodeDocx(decoded.source, decoded.document), {
      base64: true,
    });
    const secondRelationships =
      (await secondSave.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
    expect(secondRelationships.match(/rIdRotliImage/g)).toHaveLength(1);
  });

  test("control characters typed into a run never make document.xml invalid XML", async () => {
    // A native Ctrl+A in the editor's input typed U+0001 into the page; Word and
    // strict XML parsers reject the whole file when it is written verbatim.
    const base64 = await createDocxBase64({ title: "", blocks: [{ kind: "paragraph", text: "Body" }] });
    const decoded = await decodeDocx(base64, "storage/rotli/control.docx");
    decoded.document.content[0] = {
      kind: "paragraph",
      paragraph: { runs: [{ text: "Keep\u0001 this\tand\u000bthat\uFFFF." }] },
    };
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const saved = await (
      await JSZip.loadAsync(encoded, { base64: true })
    )
      .file("word/document.xml")
      ?.async("string");

    expect(saved).toBeDefined();
    for (const control of ["\u0001", "\u000b", "\uffff"]) expect(saved).not.toContain(control);
    expect(saved).toContain("Keep this");
    expect(saved).toContain("<w:tab/>");
  });

  // 2026-10-01 (the Univer review): an edited numbered list saved as a bullet
  // list — the encoder wrote numId 1 for every list, and only numId 2 decoded
  // as numbered. A list's kind now comes from the file's own numbering.
  const listDoc = (items: { list: "bullet" | "number"; text: string }[]) =>
    createDocxBase64({
      title: "Lists",
      content: items.map((item) => ({
        kind: "paragraph" as const,
        paragraph: { list: item.list, runs: [{ text: item.text }] },
      })),
    });
  const lists = (document: { content: { kind: string; paragraph?: { list?: string } }[] }) =>
    document.content.flatMap((content) =>
      content.kind === "paragraph" && content.paragraph?.list ? [content.paragraph.list] : [],
    );

  test("an edited numbered list stays numbered, and a bullet stays a bullet", async () => {
    const decoded = await decodeDocx(
      await listDoc([
        { list: "number", text: "one" },
        { list: "bullet", text: "dot" },
      ]),
      "storage/rotli/lists.docx",
    );
    for (const content of decoded.document.content) {
      if (content.kind === "paragraph" && content.paragraph.list)
        content.paragraph.runs = [{ text: "edited" }];
    }
    const again = await decodeDocx(
      await encodeDocx(decoded.source, decoded.document),
      "storage/rotli/lists.docx",
    );
    expect(lists(again.document)).toEqual(["number", "bullet"]);
  });

  test("a Word file's own list numbering decides numbered or bullet, and an edit keeps it", async () => {
    const zip = await JSZip.loadAsync(await listDoc([{ list: "number", text: "one" }]), { base64: true });
    // another app's numbering: numId 7 is decimal, numId 3 is a bullet
    zip.file(
      "word/numbering.xml",
      `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="4"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="5"/></w:num></w:numbering>`,
    );
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    zip.file("word/document.xml", xml.replace(/<w:numId w:val="\d+"\/>/, '<w:numId w:val="7"/>'));
    const base64 = await zip.generateAsync({ type: "base64" });
    const decoded = await decodeDocx(base64, "storage/rotli/foreign.docx");
    expect(lists(decoded.document)).toEqual(["number"]);
    const first = decoded.document.content.find(
      (content) => content.kind === "paragraph" && content.paragraph.list,
    );
    if (first?.kind !== "paragraph") throw new Error("expected the list paragraph");
    first.paragraph.runs = [{ text: "edited" }];
    // a new bullet uses the file's own bullet numbering
    decoded.document.content.push({
      kind: "paragraph",
      paragraph: { list: "bullet", runs: [{ text: "new" }] },
    });
    const saved = await encodeDocx(decoded.source, decoded.document);
    const savedXml =
      (await (await JSZip.loadAsync(saved, { base64: true })).file("word/document.xml")?.async("string")) ??
      "";
    expect(savedXml).toContain('<w:numId w:val="7"/>');
    expect(savedXml).toContain('<w:numId w:val="3"/>');
    expect(lists((await decodeDocx(saved, "storage/rotli/foreign.docx")).document)).toEqual([
      "number",
      "bullet",
    ]);
  });

  // 2026-10-01 (the Univer review): editing a commented paragraph dropped the
  // comment's start and end markers and left its reference dangling. The
  // comment now spans the edited paragraph.
  test("a commented paragraph keeps its comment around the edited text", async () => {
    const zip = await JSZip.loadAsync(
      await createDocxBase64({ title: "Notes", blocks: [{ kind: "paragraph", text: "Reviewed text" }] }),
      { base64: true },
    );
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    zip.file(
      "word/document.xml",
      xml.replace(
        /(<w:p>(?:(?!<\/w:p>).)*?)(<w:r>(?:(?!<\/w:p>).)*?Reviewed text(?:(?!<\/w:p>).)*?<\/w:r>)/s,
        '$1<w:commentRangeStart w:id="0"/>$2<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
      ),
    );
    const decoded = await decodeDocx(await zip.generateAsync({ type: "base64" }), "storage/rotli/notes.docx");
    const paragraph = decoded.document.content.find(
      (content) =>
        content.kind === "paragraph" && content.paragraph.runs.some((run) => run.text === "Reviewed text"),
    );
    if (paragraph?.kind !== "paragraph") throw new Error("expected the commented paragraph");
    paragraph.paragraph.runs = [{ text: "Edited text" }];
    const saved = await encodeDocx(decoded.source, decoded.document);
    const savedXml =
      (await (await JSZip.loadAsync(saved, { base64: true })).file("word/document.xml")?.async("string")) ??
      "";
    const commented =
      /<w:p\b(?:(?!<\/w:p>).)*?Edited text(?:(?!<\/w:p>).)*?<\/w:p>/s.exec(savedXml)?.[0] ?? "";
    const start = commented.indexOf("commentRangeStart");
    const text = commented.indexOf("Edited text");
    const end = commented.indexOf("commentRangeEnd");
    const reference = commented.indexOf("commentReference");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(text);
    expect(end).toBeGreaterThan(text);
    expect(reference).toBeGreaterThan(end);
  });

  /** A one-paragraph document whose text sits in a hyperlink to `target`. */
  async function linkedDocx(target: string): Promise<string> {
    const zip = await JSZip.loadAsync(
      await createDocxBase64({
        title: "Guide links",
        blocks: [
          { kind: "paragraph", text: "Read the guide" },
          { kind: "paragraph", text: "Untouched" },
        ],
      }),
      { base64: true },
    );
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    zip.file(
      "word/document.xml",
      xml.replace(
        '<w:r><w:t xml:space="preserve">Read the guide</w:t></w:r>',
        '<w:r><w:t xml:space="preserve">Read </w:t></w:r><w:hyperlink r:id="rIdGuide" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the guide</w:t></w:r></w:hyperlink>',
      ),
    );
    const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
    zip.file(
      "word/_rels/document.xml.rels",
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdGuide" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`,
      ),
    );
    return zip.generateAsync({ type: "base64" });
  }

  const linkedParagraph = (document: EditableDocument) => {
    const found = document.content.find(
      (content) =>
        content.kind === "paragraph" && /^(Read|Open) /.test(content.paragraph.runs[0]?.text ?? ""),
    );
    if (found?.kind !== "paragraph") throw new Error("expected the linked paragraph");
    return found.paragraph;
  };

  const saved = async (base64: string, part: string) =>
    (await (await JSZip.loadAsync(base64, { base64: true })).file(part)?.async("string")) ?? "";

  test("a Word web link reads as a linked run and an edit keeps it a link", async () => {
    const decoded = await decodeDocx(await linkedDocx("https://rotli.co/guide"), "storage/rotli/links.docx");
    const first = linkedParagraph(decoded.document);
    expect(first.runs).toEqual([{ text: "Read " }, { text: "the guide", link: "https://rotli.co/guide" }]);
    expect(decoded.warnings).toEqual([]);

    first.runs = [{ text: "Open " }, { text: "the new guide", link: "https://rotli.co/guide" }];
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const xml = await saved(encoded, "word/document.xml");
    expect(xml).toContain(
      '<w:hyperlink r:id="rIdGuide" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>',
    );
    expect(xml).toContain("the new guide</w:t></w:r></w:hyperlink>");
    // the link reuses its relationship; nothing is added
    expect(await saved(encoded, "word/_rels/document.xml.rels")).not.toContain("rIdRotliLink");
    const reopened = await decodeDocx(encoded, "storage/rotli/links.docx");
    expect(linkedParagraph(reopened.document).runs[1]).toEqual({
      text: "the new guide",
      link: "https://rotli.co/guide",
    });
  });

  test("a new link adds its relationship and Word's link style", async () => {
    const decoded = await decodeDocx(
      await createDocxBase64({ title: "Plan", blocks: [{ kind: "paragraph", text: "See Rotli" }] }),
      "storage/rotli/plan.docx",
    );
    const paragraph = decoded.document.content.find(
      (content) => content.kind === "paragraph" && content.paragraph.runs[0]?.text === "See Rotli",
    );
    if (paragraph?.kind !== "paragraph") throw new Error("expected the paragraph");
    paragraph.paragraph.runs = [
      { text: "Find " },
      { text: "Rotli", link: "https://rotli.co/new" },
      { text: " and " },
      { text: "write", link: "mailto:hello@rotli.co" },
    ];
    const encoded = await encodeDocx(decoded.source, decoded.document);
    const rels = await saved(encoded, "word/_rels/document.xml.rels");
    expect(rels).toMatch(/Target="https:\/\/rotli\.co\/new" TargetMode="External"/);
    expect(rels).toContain('Target="mailto:hello@rotli.co" TargetMode="External"');
    expect(await saved(encoded, "word/styles.xml")).toMatch(/styleId="Hyperlink"/);
    expect(await saved(encoded, "word/document.xml")).toContain('<w:rStyle w:val="Hyperlink"/>');
    const reopened = await decodeDocx(encoded, "storage/rotli/plan.docx");
    const again = reopened.document.content.find(
      (content) => content.kind === "paragraph" && content.paragraph.runs[0]?.text === "Find ",
    );
    expect(again?.kind === "paragraph" && again.paragraph.runs.map((run) => run.link)).toEqual([
      undefined,
      "https://rotli.co/new",
      undefined,
      "mailto:hello@rotli.co",
    ]);
  });

  test("a link to anything but the web or mail is no link, and its paragraph stays unedited", async () => {
    const decoded = await decodeDocx(await linkedDocx("javascript:alert(1)"), "storage/rotli/links.docx");
    const first = linkedParagraph(decoded.document);
    expect(first.runs.some((run) => run.link)).toBe(false);
    expect(decoded.warnings.join(" ")).toMatch(/advanced Word content/);
    first.runs = [{ text: "Changed" }];
    await expect(encodeDocx(decoded.source, decoded.document)).rejects.toThrow(/unsupported Word inline/i);
  });
});
