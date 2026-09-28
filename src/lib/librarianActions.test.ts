import { describe, expect, test } from "bun:test";

import {
  addAnchor,
  anchorFromSelection,
  ANCHOR_LIMITS,
  describeLibrarianAction,
  mergeTags,
  parseAnchors,
  parseLibrarianReply,
  resolveAnchor,
} from "./librarianActions";

const NOTE =
  "# Maya Chen\n\nMet Maya at the design meetup. She runs research at Northwind.\n\nFollow up in March.";

describe("anchors", () => {
  test("a selection becomes its words plus a little text on each side", () => {
    const at = NOTE.indexOf("runs research");
    const anchor = anchorFromSelection(NOTE, at, at + "runs research".length, "  her job  ");
    expect(anchor).toEqual({
      exact: "runs research",
      prefix: NOTE.slice(at - ANCHOR_LIMITS.context, at),
      suffix: " at Northwind.\n\nFollow up in Mar",
      label: "her job",
    });
    expect(anchorFromSelection(NOTE, 5, 5)).toBeNull();
    // a long highlight keeps its first 280 characters
    const long = "x".repeat(400);
    expect(anchorFromSelection(long, 0, 400)!.exact).toHaveLength(ANCHOR_LIMITS.exact);
  });

  test("a pointer finds its passage again after edits elsewhere", () => {
    const at = NOTE.indexOf("Northwind");
    const anchor = anchorFromSelection(NOTE, at, at + 9)!;
    const edited = `A new first line.\n${NOTE}`;
    expect(resolveAnchor(edited, anchor)).toEqual({
      kind: "found",
      from: edited.indexOf("Northwind"),
      to: edited.indexOf("Northwind") + 9,
    });
  });

  test("words that now appear twice read as moved, and missing words as gone", () => {
    const anchor = { exact: "Maya", prefix: "zzz", suffix: "zzz" };
    expect(resolveAnchor(NOTE, anchor)).toEqual({ kind: "moved" });
    expect(resolveAnchor(NOTE, { exact: "Lisbon", prefix: "", suffix: "" })).toEqual({ kind: "gone" });
  });

  test("the field is one JSON line; the same passage replaces itself; the oldest drop past 20", () => {
    const one = { exact: "a", prefix: "", suffix: "" };
    let value = addAnchor("", one);
    expect(value).toBe('[{"exact":"a","prefix":"","suffix":""}]');
    value = addAnchor(value, { ...one, label: "renamed" });
    expect(parseAnchors(value)).toEqual([{ ...one, label: "renamed" }]);
    for (let n = 0; n < 25; n++) value = addAnchor(value, { exact: `p${n}`, prefix: "", suffix: "" });
    const kept = parseAnchors(value);
    expect(kept).toHaveLength(ANCHOR_LIMITS.perNote);
    expect(kept[0]!.exact).toBe("p5");
    expect(value.includes("\n")).toBe(false);
  });

  test("a malformed field reads as no pointers", () => {
    expect(parseAnchors("not json")).toEqual([]);
    expect(parseAnchors('[{"prefix":"x"},{"exact":"ok"}]')).toEqual([
      { exact: "ok", prefix: "", suffix: "" },
    ]);
  });
});

describe("tags", () => {
  test("new tags join the list; existing ones keep their spelling and place", () => {
    expect(mergeTags("[ai, Rotli]", ["rotli", "people"])).toBe("[ai, Rotli, people]");
    expect(mergeTags("", ["person"])).toBe("[person]");
  });
});

describe("the reply grammar", () => {
  const context = { doc: NOTE, highlight: null, areas: ["Projects", "Reading"] };

  test("tags, a mark, and a filing come through; the reply may be wrapped", () => {
    const reply =
      'Sure!\n```json\n{"actions":[{"type":"tag","tags":["person","Design, meetup"]},{"type":"mark","exact":"Follow up in March","label":"next step"},{"type":"file","area":"wiki/projects"}]}\n```';
    const actions = parseLibrarianReply(reply, context);
    expect(actions[0]).toEqual({ type: "tag", tags: ["person", "Design meetup"] });
    expect(actions[1]).toMatchObject({
      type: "mark",
      anchor: { exact: "Follow up in March", label: "next step" },
    });
    expect(actions[2]).toEqual({ type: "file", area: "Projects", create: false });
  });

  test("anything outside the grammar is dropped, never guessed", () => {
    const reply = JSON.stringify({
      actions: [
        { type: "tag", tags: ["", "x".repeat(41), 7] },
        { type: "mark", exact: "words that are not in the note" },
        { type: "file", area: "Nowhere" },
        { type: "delete", note: "all" },
        "junk",
      ],
    });
    expect(parseLibrarianReply(reply, context)).toEqual([]);
    expect(parseLibrarianReply("no json here", context)).toEqual([]);
  });

  test("the user's highlight is the passage marked, whatever words the model sent", () => {
    const at = NOTE.indexOf("design meetup");
    const highlight = anchorFromSelection(NOTE, at, at + "design meetup".length)!;
    const reply = '{"actions":[{"type":"mark","exact":"something else","label":"where we met"}]}';
    expect(parseLibrarianReply(reply, { ...context, highlight })).toEqual([
      { type: "mark", anchor: { ...highlight, label: "where we met" } },
    ]);
  });

  test("People may be created; only the first filing counts", () => {
    const reply = '{"actions":[{"type":"file","area":"people"},{"type":"file","area":"Projects"}]}';
    expect(parseLibrarianReply(reply, context)).toEqual([{ type: "file", area: "People", create: true }]);
  });

  test("each action reads as one line", () => {
    expect(describeLibrarianAction({ type: "tag", tags: ["person", "q3"] })).toBe("Tag the note: person, q3");
    expect(describeLibrarianAction({ type: "file", area: "People", create: true })).toBe(
      "File it in People (a new area)",
    );
  });
});
