import { describe, expect, test } from "bun:test";

import { PREVIEW_MAX_LINES, previewText, wikilinkAt } from "./wikilinkPreview";

describe("wikilinkAt", () => {
  const line = "see [[Plan|the plan]] and [[Other]] today";

  test("finds the link under a column, with its span and target", () => {
    expect(wikilinkAt(line, 8)).toEqual({ from: 4, to: 21, target: "Plan|the plan" });
    expect(wikilinkAt(line, 30)).toEqual({ from: 26, to: 35, target: "Other" });
  });

  test("the edges count, the gaps do not", () => {
    expect(wikilinkAt(line, 4)?.target).toBe("Plan|the plan");
    expect(wikilinkAt(line, 21)?.target).toBe("Plan|the plan");
    expect(wikilinkAt(line, 2)).toBeNull();
    expect(wikilinkAt(line, 23)).toBeNull();
    expect(wikilinkAt("no links here", 3)).toBeNull();
  });
});

describe("previewText", () => {
  test("shows the top of the note as it reads, without the title it already names", () => {
    const body = "# Meeting notes\n\nWe agreed on **three** things:\n\n- ship the fix\n- [x] write it down\n";
    expect(previewText(body, "Meeting notes")).toBe(
      "We agreed on three things:\nship the fix\nwrite it down",
    );
  });

  test("keeps a first heading that is not the title", () => {
    expect(previewText("## Agenda\nitems", "Meeting notes")).toBe("Agenda\nitems");
  });

  test("stops after a few lines and says there is more", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const lines = previewText(body, "T").split("\n");
    expect(lines).toHaveLength(PREVIEW_MAX_LINES + 1);
    expect(lines.at(-1)).toBe("…");
  });

  test("fenced blocks and embeds never spill source into the card", () => {
    const body = "intro\n```rotli-board\nid: 01ABC\n```\n![shot](storage:a.png)\noutro";
    expect(previewText(body, "T")).toBe("intro\noutro");
  });

  test("an empty note says so", () => {
    expect(previewText("# Only a title\n\n", "Only a title")).toBe("");
  });
});
