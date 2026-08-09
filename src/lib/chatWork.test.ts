import { describe, expect, test } from "bun:test";

import { artifactReference, attachmentReference, projectChatWorkItems, visibleChatText } from "./chatWork";

describe("chat Work references", () => {
  test("stores attached images as portable storage links without showing paths in the bubble", () => {
    const reference = attachmentReference(1, "vault:storage/images/Architecture #1 sketch.png");

    expect(reference).toBe("[Image #1](storage:images/Architecture%20%231%20sketch.png)");
    expect(visibleChatText(`${reference}\nWhat does this show?`)).toBe("[Image #1]\nWhat does this show?");
  });

  test("uses portable file links and validated deep links for note/board surfaces", () => {
    expect(artifactReference("Plan", "vault:storage/rotli/Quarterly plan.docx", "file")).toBe(
      "[Plan](storage:rotli/Quarterly%20plan.docx)",
    );
    const source = artifactReference("Plan — editable source", "vault:01ABC", "note");
    const board = artifactReference("Map", "vault:Board/map.excalidraw", "canvas");
    const projected = projectChatWorkItems({
      rootPrefix: "vault:",
      messages: [{ text: `${source}\n${board}` }],
      discoveredIds: [],
    });
    expect(projected.map((item) => [item.id, item.surfaceKind, item.name])).toEqual([
      ["vault:01ABC", "note", "Plan — editable source"],
      ["vault:Board/map.excalidraw", "canvas", "Map"],
    ]);
    expect(visibleChatText(`Use ${source}: revise the opening.`)).toBe(
      "Use [Plan — editable source]: revise the opening.",
    );
  });

  test("projects referenced attachments and generated files into one deduplicated Work list", () => {
    const items = projectChatWorkItems({
      rootPrefix: "vault:",
      messages: [
        {
          text: "[Image #1](storage:images/Architecture%20%231%20sketch.png)\nReview this.",
        },
        {
          text: "[Artifact: Rotli brief](storage:rotli/rotli-brief.docx)",
        },
      ],
      discoveredIds: [
        "vault:storage/images/Architecture #1 sketch.png",
        "vault:storage/chats/rotli-tech-stack/generated-diagram.png",
      ],
    });

    expect(items).toEqual([
      {
        id: "vault:storage/images/Architecture #1 sketch.png",
        kind: "image",
        name: "Architecture #1 sketch.png",
        source: "attachment",
        surfaceKind: "file",
      },
      {
        id: "vault:storage/rotli/rotli-brief.docx",
        kind: "artifact",
        name: "rotli-brief.docx",
        source: "generated",
        surfaceKind: "file",
      },
      {
        id: "vault:storage/chats/rotli-tech-stack/generated-diagram.png",
        kind: "image",
        name: "generated-diagram.png",
        source: "generated",
        surfaceKind: "file",
      },
    ]);
  });
});
