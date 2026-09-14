// The editor's link click: which address a click lands on, and the visible
// "couldn't open" state that replaced the silent dead click.

import { describe, expect, test } from "bun:test";

import { EditorState } from "@codemirror/state";

import { linkFailureAt, linkFailureField, linkFailurePos, webLinkAt } from "./linkTarget";

describe("webLinkAt", () => {
  test("an md link opens its url, an empty-text link too; bare autolinks open themselves", () => {
    expect(webLinkAt("see [docs](x.com) now", 6)).toBe("x.com");
    expect(webLinkAt("[](sethmedina.com)", 4)).toBe("sethmedina.com");
    expect(webLinkAt("mail a@b.co today", 7)).toBe("a@b.co");
    expect(webLinkAt("www.x.com", 0)).toBe("www.x.com");
  });

  test("prose, bare domains, and the gap between links open nothing", () => {
    expect(webLinkAt("node.js and sethmedina.com", 14)).toBeNull();
    expect(webLinkAt("[a](x.com) gap [b](y.com)", 12)).toBeNull();
  });
});

describe("link failure state", () => {
  const start = () => EditorState.create({ doc: "[x](#nowhere) more", extensions: [linkFailureField] });

  test("a failure shows at the click and the next caret move or edit clears it", () => {
    let state = start().update({ effects: linkFailureAt(3) }).state;
    expect(linkFailurePos(state)).toBe(3);
    state = state.update({ selection: { anchor: 10 } }).state;
    expect(linkFailurePos(state)).toBeNull();
    state = state.update({ effects: linkFailureAt(2) }).state;
    state = state.update({ changes: { from: 0, insert: "a" } }).state;
    expect(linkFailurePos(state)).toBeNull();
  });

  test("an unrelated transaction keeps the note", () => {
    const state = start().update({ effects: linkFailureAt(3) }).state;
    expect(linkFailurePos(state.update({}).state)).toBe(3);
  });
});
