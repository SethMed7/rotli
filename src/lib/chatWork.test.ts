import { describe, expect, test } from "bun:test";

import { attachmentReference, projectChatWorkItems, visibleChatText } from "./chatWork";

describe("chat Work references", () => {
  test("stores attached images as portable storage links without showing paths in the bubble", () => {
    const reference = attachmentReference(1, "vault:storage/images/Architecture #1 sketch.png");

    expect(reference).toBe("[Image #1](storage:images/Architecture%20%231%20sketch.png)");
    expect(visibleChatText(`${reference}\nWhat does this show?`)).toBe("[Image #1]\nWhat does this show?");
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
      },
      {
        id: "vault:storage/rotli/rotli-brief.docx",
        kind: "artifact",
        name: "rotli-brief.docx",
        source: "generated",
      },
      {
        id: "vault:storage/chats/rotli-tech-stack/generated-diagram.png",
        kind: "image",
        name: "generated-diagram.png",
        source: "generated",
      },
    ]);
  });
});
