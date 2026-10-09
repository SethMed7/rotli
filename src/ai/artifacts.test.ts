import { describe, expect, test } from "bun:test";

import type { EditableDocument } from "../documents/model";
import {
  artifactFileName,
  editableDocumentForAi,
  markdownToDocumentDraft,
  offeredArtifactKinds,
} from "./artifacts";

describe("chat artifact policy", () => {
  test("names generated files predictably without accepting path syntax", () => {
    expect(artifactFileName("Quarterly Plan", "docx")).toBe("quarterly-plan.docx");
    expect(artifactFileName("../Plan / Final", "xlsx")).toBe("plan-final.xlsx");
    expect(artifactFileName("", "pdf")).toBe("untitled.pdf");
  });

  // 2026-10-01: numbered blocks a model can point at, not flat text
  test("the chat reads a Word document as numbered blocks: headings, lists, table cells, images", () => {
    const document: EditableDocument = {
      id: "plan.docx",
      title: "Plan",
      content: [
        { kind: "paragraph", paragraph: { namedStyle: "heading1", runs: [{ text: "Launch" }] } },
        { kind: "paragraph", paragraph: { runs: [{ text: "Ship" }, { text: " calmly" }] } },
        { kind: "paragraph", paragraph: { list: "bullet", runs: [{ text: "Design" }] } },
        {
          kind: "table",
          table: {
            id: "owners",
            rows: [
              {
                cells: [
                  { paragraphs: [{ runs: [{ text: "Owner" }] }] },
                  { paragraphs: [{ runs: [{ text: "Status" }] }] },
                ],
              },
            ],
          },
        },
        {
          kind: "image",
          image: {
            id: "diagram",
            name: "architecture.png",
            mimeType: "image/png",
            base64: "AA==",
            widthPx: 640,
            heightPx: 360,
            alt: "Architecture overview",
          },
        },
      ],
    };
    expect(editableDocumentForAi(document)).toBe(
      [
        "[1] Heading 1: Launch",
        "[2] paragraph: Ship calmly",
        "[3] bullet item: Design",
        "[4] table (1 rows × 2 columns):",
        "  r1c1: Owner",
        "  r1c2: Status",
        "[5] image: Architecture overview",
      ].join("\n"),
    );
  });

  test("maps ordinary Markdown into the editable DOCX subset", () => {
    expect(
      markdownToDocumentDraft(
        "Launch plan",
        "# Launch plan\n\n## Goals\n\nShip the calm version.\n\n### Owners\n\n- Design: Mina\n- Engineering: Jo",
      ),
    ).toEqual({
      title: "Launch plan",
      blocks: [
        { kind: "heading", level: 2, text: "Goals" },
        { kind: "paragraph", text: "Ship the calm version." },
        { kind: "heading", level: 3, text: "Owners" },
        { kind: "paragraph", text: "• Design: Mina" },
        { kind: "paragraph", text: "• Engineering: Jo" },
      ],
    });
  });
});

test("chat offers workbooks only where the build has sheets", () => {
  expect(offeredArtifactKinds({ sheets: false })).toEqual(["document", "pdf"]);
  expect(offeredArtifactKinds({ sheets: true })).toEqual(["document", "sheet", "pdf"]);
});
