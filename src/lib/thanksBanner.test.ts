import { describe, expect, test } from "bun:test";

import { bannerText, SHARE_CAPTION, SHARE_MESSAGE, shareOnXUrl, shareStatus } from "./thanksBanner";

describe("the banner's words", () => {
  test("thanks by first name, with nothing about the choices made", () => {
    const text = bannerText("  Ada Lovelace ");
    expect(text.headline).toBe("Thank you, Ada");
    expect(text.subline).toMatch(/^for trying Rotli\./);
    expect(Object.keys(text).sort()).toEqual(["headline", "subline"]);
  });

  test("no name: a plain thank-you, no dangling comma", () => {
    expect(bannerText("").headline).not.toContain(",");
  });

  test("a very long name is cut to fit", () => {
    const { headline } = bannerText("x".repeat(60));
    expect(headline.length).toBeLessThanOrEqual("Thank you, ".length + 24);
    expect(headline.endsWith("…")).toBe(true);
  });
});

test("Share carries a fixed line short enough for the share sheet, nothing personal", () => {
  // share_sheet.rs refuses anything longer than 280 characters
  expect(Array.from(SHARE_MESSAGE).length).toBeLessThanOrEqual(280);
  expect(SHARE_MESSAGE).not.toContain("http");
});

test("after Share the card speaks only when no sheet did", () => {
  expect(shareStatus("sheet")).toBe("");
  expect(shareStatus("cancelled")).toBe("");
  expect(shareStatus("copied")).toMatch(/copied/);
  expect(shareStatus("failed")).toContain("rotli.co");
});

test("Share on X carries the fixed caption and the site, nothing personal", () => {
  const url = new URL(shareOnXUrl());
  expect(url.origin).toBe("https://x.com");
  expect(url.pathname).toBe("/intent/post");
  expect(url.searchParams.get("text")).toBe(SHARE_CAPTION);
  expect(url.searchParams.get("url")).toBe("https://rotli.co");
  expect([...url.searchParams.keys()].sort()).toEqual(["text", "url"]);
});
