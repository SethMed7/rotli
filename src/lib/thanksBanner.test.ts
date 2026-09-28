import { describe, expect, test } from "bun:test";

import {
  bannerText,
  clipPolygon,
  maskUrl,
  SHARE_CAPTION,
  shareOnXUrl,
  transformMatrix,
} from "./thanksBanner";

describe("the banner's words", () => {
  test("greets by first name and lists the choices that were made", () => {
    expect(
      bannerText({
        userName: "  Ada Lovelace ",
        themeLabel: "Grove Dark",
        quokkaLabel: "Fern",
        accessoryLabel: "Bucket hat",
      }),
    ).toMatchObject({
      headline: "Welcome to Rotli, Ada",
      chips: ["Grove Dark", "Fern quokka", "Bucket hat"],
    });
  });

  test("no name, plain quokka, nothing worn: only the theme", () => {
    const text = bannerText({ userName: "", themeLabel: "Paper", quokkaLabel: null, accessoryLabel: null });
    expect(text.headline).not.toContain(","); // no name, no dangling comma
    expect(text.chips).toEqual(["Paper"]);
  });

  test("a very long name is cut to fit", () => {
    const { headline } = bannerText({
      userName: "x".repeat(60),
      themeLabel: "Paper",
      quokkaLabel: null,
      accessoryLabel: null,
    });
    expect(headline.length).toBeLessThanOrEqual("Welcome to Rotli, ".length + 24);
    expect(headline.endsWith("…")).toBe(true);
  });
});

test("Share on X carries the fixed caption and the site, nothing personal", () => {
  const url = new URL(shareOnXUrl());
  expect(url.origin).toBe("https://x.com");
  expect(url.pathname).toBe("/intent/post");
  expect(url.searchParams.get("text")).toBe(SHARE_CAPTION);
  expect(url.searchParams.get("url")).toBe("https://rotli.co");
  expect([...url.searchParams.keys()].sort()).toEqual(["text", "url"]);
});

describe("reading computed styles", () => {
  test("a polygon clip in percent and pixels", () => {
    expect(clipPolygon("polygon(0px 0px, 50% 0px, 100% 25%, 0px 100%)", 200, 200)).toEqual([
      [0, 0],
      [100, 0],
      [200, 50],
      [0, 200],
    ]);
  });

  test("an inset clip, one to four values", () => {
    expect(clipPolygon("inset(0px 10% 0px 5%)", 100, 100)).toEqual([
      [5, 0],
      [90, 0],
      [90, 100],
      [5, 100],
    ]);
    expect(clipPolygon("inset(10px)", 100, 100)).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ]);
  });

  test("none and nonsense clip nothing", () => {
    expect(clipPolygon("none", 10, 10)).toBeNull();
    expect(clipPolygon("circle(50%)", 10, 10)).toBeNull();
  });

  test("a transform matrix, and none as identity", () => {
    expect(transformMatrix("matrix(0.9, 0.1, -0.1, 0.9, 4, -2)")).toEqual([0.9, 0.1, -0.1, 0.9, 4, -2]);
    expect(transformMatrix("none")).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transformMatrix("matrix3d(1)")).toBeNull();
  });

  test("a mask url, quoted or not", () => {
    expect(maskUrl('url("/assets/base-mask.webp")')).toBe("/assets/base-mask.webp");
    expect(maskUrl("url(data:image/webp;base64,AAAA)")).toBe("data:image/webp;base64,AAAA");
    expect(maskUrl("none")).toBeNull();
  });

  test("an inline SVG mask keeps its own quotes (the bucket hat's)", () => {
    const svg =
      "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20512%20512'%3e%3c/svg%3e";
    expect(maskUrl(`url("${svg}")`)).toBe(svg);
    expect(maskUrl(`url('a\\'b')`)).toBe("a'b");
  });
});
