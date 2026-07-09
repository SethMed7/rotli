// The fence scanner's pure logic — exercised around the ```html addition
// (INC-2): html is a target lang, scanning finds it, innerCode extracts the
// body verbatim, and the pre-existing langs + skip rules still hold.

import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { TARGET_LANGS, innerCode, lineInFence, scanFences } from "./fences";

function doc(...lines: string[]): Text {
  return Text.of(lines);
}

describe("scanFences", () => {
  test("html is a target lang", () => {
    expect(TARGET_LANGS.has("html")).toBe(true);
  });

  test("board and sheet are target langs", () => {
    expect(TARGET_LANGS.has("board")).toBe(true);
    expect(TARGET_LANGS.has("sheet")).toBe(true);
  });

  test("finds a closed ```board fence", () => {
    const d = doc("```board", "storage/foo.excalidraw", "```");
    const fences = scanFences(d);
    expect(fences.length).toBe(1);
    expect(fences[0]?.lang).toBe("board");
    expect(fences[0]?.target).toBe(true);
    expect(innerCode(d, fences[0]!.from, fences[0]!.to)).toBe("storage/foo.excalidraw");
  });

  test("finds a closed ```html fence", () => {
    const d = doc("intro", "```html", "<p>hi</p>", "```", "outro");
    const fences = scanFences(d);
    expect(fences.length).toBe(1);
    expect(fences[0]?.lang).toBe("html");
    expect(fences[0]?.target).toBe(true);
    expect(fences[0]?.from).toBe(d.line(2).from);
    expect(fences[0]?.to).toBe(d.line(4).to);
  });

  test("innerCode returns the fence body verbatim", () => {
    const d = doc("```html", "<div>", "  <b>x</b>", "</div>", "```");
    const [f] = scanFences(d);
    expect(f).toBeDefined();
    if (!f) return;
    expect(innerCode(d, f.from, f.to)).toBe("<div>\n  <b>x</b>\n</div>");
  });

  test("empty-body fence yields empty innerCode", () => {
    const d = doc("```html", "```");
    const [f] = scanFences(d);
    expect(f).toBeDefined();
    if (!f) return;
    expect(innerCode(d, f.from, f.to)).toBe("");
  });

  test("an unterminated ```html fence is skipped (plain text)", () => {
    const d = doc("```html", "<p>half-typed");
    expect(scanFences(d)).toEqual([]);
  });

  test("a non-target lang (```js) scans too, flagged target:false (#13)", () => {
    const d = doc("```js", "let x = 1;", "```", "```html", "<hr>", "```");
    const fences = scanFences(d);
    expect(fences.map((f) => [f.lang, f.target])).toEqual([
      ["js", false],
      ["html", true],
    ]);
  });

  test("a bare ``` fence scans as lang '' target:false (#13)", () => {
    const d = doc("```", "# not a heading", "```");
    const fences = scanFences(d);
    expect(fences.length).toBe(1);
    expect(fences[0]?.lang).toBe("");
    expect(fences[0]?.target).toBe(false);
    // livePreview skips every fenced line via lineInFence — the `# h` inside
    // a plain fence never gets H1-styled
    expect(lineInFence(d.line(2).from, fences)).toBe(true);
  });

  test("all five target langs scan with target:true", () => {
    const d = doc(
      "```math", "x", "```",
      "```mermaid", "x", "```",
      "```jsxgraph", "x", "```",
      "```svg", "x", "```",
      "```html", "x", "```",
    );
    const fences = scanFences(d);
    expect(fences.map((f) => f.lang)).toEqual(["math", "mermaid", "jsxgraph", "svg", "html"]);
    expect(fences.every((f) => f.target)).toBe(true);
  });

  test("lineInFence covers the open line, body, and close line", () => {
    const d = doc("before", "```html", "<p>hi</p>", "```", "after");
    const fences = scanFences(d);
    expect(lineInFence(d.line(1).from, fences)).toBe(false);
    expect(lineInFence(d.line(2).from, fences)).toBe(true);
    expect(lineInFence(d.line(3).from, fences)).toBe(true);
    expect(lineInFence(d.line(4).from, fences)).toBe(true);
    expect(lineInFence(d.line(5).from, fences)).toBe(false);
  });
});
