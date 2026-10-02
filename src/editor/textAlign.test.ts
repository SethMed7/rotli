import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";

import { alignOf, parseAlignedLine } from "./alignedLine";
import { clipboardHtml } from "./copyClipboard";
import { slashInsertion } from "./slashActions";
import { stripMarkdown } from "./stripMarkdown";
import { alignSpec, alignedEnterSpec, canAlign } from "./textAlign";

/** Run a spec against a doc with `^` marking the caret, or `[`…`]` a selection. */
function run(source: string, spec: (state: EditorState) => TransactionSpec | null): string | null {
  const anchor = source.includes("[") ? source.indexOf("[") : source.indexOf("^");
  const plain = source.replace(/[[\]^]/g, "");
  const head = source.includes("]") ? source.indexOf("]") - 1 : anchor;
  const state = EditorState.create({ doc: plain, selection: EditorSelection.range(anchor, head) });
  const tx = spec(state);
  if (!tx) return null;
  const next = state.update(tx).state;
  const { from, to } = next.selection.main;
  const doc = next.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}^${doc.slice(from)}`
    : `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
}

describe("the alignment grammar", () => {
  test("reads exactly the form Rotli writes", () => {
    expect(parseAlignedLine('<p align="center">Hello **you**</p>')).toEqual({
      align: "center",
      open: 18,
      inner: "Hello **you**",
    });
    expect(parseAlignedLine('<p align="right"></p>')?.align).toBe("right");
    expect(alignOf('<p align="left">x</p>')).toBe("left");
    expect(alignOf("plain")).toBe("left");
    for (const other of [
      '<p align="justify">x</p>',
      "<p align='center'>x</p>",
      '<p align="center">x',
      "<p>x</p>",
    ]) {
      expect(parseAlignedLine(other)).toBeNull();
    }
  });

  test("only paragraphs can be aligned", () => {
    expect(canAlign("A sentence with <u>marks</u>.")).toBe(true);
    expect(canAlign("<u>Underlined</u> first")).toBe(true);
    expect(canAlign('<p align="right">x</p>')).toBe(true);
    for (const not of [
      "",
      "  ",
      "## A heading",
      "- item",
      "1. item",
      "- [ ] task",
      "> a quoted line",
      "---",
      "| a | b |",
    ]) {
      expect(canAlign(not)).toBe(false);
    }
    expect(canAlign("![photo](storage:a.png)")).toBe(false);
    expect(canAlign("<div>raw</div>")).toBe(false);
  });
});

describe("Align over the selection", () => {
  test("a caret line gains the tags; the caret keeps its place in the text", () => {
    expect(run("Hel^lo", (s) => alignSpec(s, "center"))).toBe('<p align="center">Hel^lo</p>');
    expect(run("^Hello", (s) => alignSpec(s, "right"))).toBe('<p align="right">^Hello</p>');
    expect(run("Hello^", (s) => alignSpec(s, "center"))).toBe('<p align="center">Hello^</p>');
  });

  test("re-aligning swaps the tag, left removes the tags, the same choice changes nothing", () => {
    expect(run('<p align="center">Hi^</p>', (s) => alignSpec(s, "right"))).toBe('<p align="right">Hi^</p>');
    expect(run('<p align="center">H^i</p>', (s) => alignSpec(s, "left"))).toBe("H^i");
    expect(run('<p align="center">H^i</p>', (s) => alignSpec(s, "center"))).toBeNull();
    expect(run("Plain^", (s) => alignSpec(s, "left"))).toBeNull();
  });

  test("a caret on an empty line starts an aligned paragraph with the caret inside", () => {
    expect(run("one\n^\ntwo", (s) => alignSpec(s, "center"))).toBe('one\n<p align="center">^</p>\ntwo');
    expect(run("one\n^", (s) => alignSpec(s, "left"))).toBeNull();
  });

  test("a selection wraps each paragraph and leaves every other block alone", () => {
    const doc =
      "[# Title\nFirst para\n\n- item\nSecond *para*\n```\ncode\n```\n| a | b |\n|---|---|\n| 1 | 2 |\nThird]";
    expect(run(doc, (s) => alignSpec(s, "center"))).toBe(
      '[# Title\n<p align="center">First para</p>\n\n- item\n<p align="center">Second *para*</p>\n```\ncode\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n<p align="center">Third</p>]',
    );
  });

  test("mixed alignments all take the chosen one; left unwraps them all", () => {
    const doc = '[<p align="right">a</p>\nb\n<p align="center">c</p>]';
    expect(run(doc, (s) => alignSpec(s, "center"))).toBe(
      '[<p align="center">a</p>\n<p align="center">b</p>\n<p align="center">c</p>]',
    );
    expect(run(doc, (s) => alignSpec(s, "left"))).toBe("[a\nb\nc]");
  });

  test("a whole line picked with the mouse does not reach into the next line", () => {
    expect(run("[one\n]two", (s) => alignSpec(s, "right"))).toBe('[<p align="right">one</p>\n]two');
  });
});

describe("Enter in an aligned paragraph", () => {
  test("starts the next paragraph with the same alignment", () => {
    expect(run('<p align="center">Hello^ there</p>', alignedEnterSpec)).toBe(
      '<p align="center">Hello</p>\n<p align="center">^ there</p>',
    );
    expect(run('<p align="right">End^</p>', alignedEnterSpec)).toBe(
      '<p align="right">End</p>\n<p align="right">^</p>',
    );
  });

  test("in an empty one ends the alignment; outside the tags it is plain Enter", () => {
    expect(run('a\n<p align="center">^</p>', alignedEnterSpec)).toBe("a\n^");
    expect(run('<p align="center">End</p>^', alignedEnterSpec)).toBeNull();
    expect(run('<p al^ign="center">End</p>', alignedEnterSpec)).toBeNull();
    expect(run("plain^ text", alignedEnterSpec)).toBeNull();
  });
});

describe("other readers of an aligned paragraph", () => {
  test("the rich copy keeps the alignment and the inline marks", () => {
    expect(clipboardHtml('<p align="center">Hi **you**</p>')).toBe(
      '<p align="center">Hi <strong>you</strong></p>',
    );
  });

  test("plain text (titles, snippets, link cards) drops the tags", () => {
    expect(stripMarkdown('<p align="right">Signed, **Ana**</p>\nnext')).toBe("Signed, Ana\nnext");
  });

  test("the slash commands start an aligned paragraph with the caret inside", () => {
    expect(slashInsertion({ kind: "align", align: "center" })).toEqual({
      insert: '<p align="center"></p>',
      caret: 18,
    });
    expect(slashInsertion({ kind: "align", align: "right" })?.caret).toBe(17);
  });
});
