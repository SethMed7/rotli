import { describe, expect, test } from "bun:test";

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
