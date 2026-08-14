import { describe, expect, test } from "bun:test";

import type { EditableDocument } from "../documents/model";
import { artifactFileName, editableDocumentText, markdownToDocumentDraft } from "./artifacts";

describe("chat artifact policy", () => {
  test("names generated files predictably without accepting path syntax", () => {
    expect(artifactFileName("Quarterly Plan", "docx")).toBe("quarterly-plan.docx");
    expect(artifactFileName("../Plan / Final", "xlsx")).toBe("plan-final.xlsx");
    expect(artifactFileName("", "pdf")).toBe("untitled.pdf");
  });

  test("projects the editable DOCX model to readable chat text", () => {
    expect(
      editableDocumentText({
        id: "plan.docx",
        title: "Plan",
        content: [
          { kind: "paragraph", paragraph: { runs: [{ text: "Launch" }, { text: " calmly" }] } },
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
        ],
      }),
    ).toBe("Launch calmly\n\nOwner\tStatus");
  });

  test("projects embedded image context without treating it as a table", () => {
    const document: EditableDocument = {
      id: "storage/example.docx",
      title: "Example",
      content: [
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
    expect(editableDocumentText(document)).toBe("Architecture overview");
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
