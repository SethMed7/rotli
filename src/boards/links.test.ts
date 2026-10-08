import { describe, expect, test } from "bun:test";

import { boardElementLinkId, classifyBoardLink } from "./links";

describe("classifyBoardLink", () => {
  test("a web address opens in the browser", () => {
    expect(classifyBoardLink("https://rotli.co/guides")).toEqual({
      kind: "web",
      url: "https://rotli.co/guides",
    });
    expect(classifyBoardLink("  http://example.com  ")).toEqual({ kind: "web", url: "http://example.com" });
    expect(classifyBoardLink("mailto:hi@example.com")).toEqual({ kind: "web", url: "mailto:hi@example.com" });
  });

  test("a wikilink opens the note, alias and heading stripped", () => {
    expect(classifyBoardLink("[[Weekly plan]]")).toEqual({ kind: "note", target: "Weekly plan" });
    expect(classifyBoardLink("[[projects/Plan.md#Goals|the plan]]")).toEqual({
      kind: "note",
      target: "projects/Plan",
    });
    expect(classifyBoardLink("[[ ]]").kind).toBe("unsupported");
  });

  test("a link to another shape is found from any origin", () => {
    for (const url of ["tauri://localhost/?element=abc123", "/?element=abc123"]) {
      expect(classifyBoardLink(url)).toEqual({ kind: "element", id: "abc123", web: null });
    }
    // a web address keeps itself as the way out when the shape isn't here
    for (const url of ["https://rotli.co/app/?element=abc123", "http://localhost:1420/?element=abc123"]) {
      expect(classifyBoardLink(url)).toEqual({ kind: "element", id: "abc123", web: url });
    }
  });

  test("schemes the app will not open are unsupported, never handed to the opener", () => {
    for (const link of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "rotli://reveal?id=x",
      "notes/plan",
      "",
    ]) {
      expect(classifyBoardLink(link).kind).toBe("unsupported");
    }
  });
});

describe("boardElementLinkId", () => {
  test("an empty element parameter is no element", () => {
    expect(boardElementLinkId("https://example.com/?element=")).toBeNull();
    expect(boardElementLinkId("https://example.com/?q=1")).toBeNull();
  });
});
