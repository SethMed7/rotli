// kindOf — the pure ext → viewer-kind decision, exercised around the html
// two-mode viewer (INC-2): .html/.htm/.xhtml leave the plain-text path and get
// the Preview ⇄ Code kind; the neighbors keep their kinds.
// Plus the image-zoom math (INC-5): fit never upscales, steps clamp sanely.
// Plus htmlPreviewDoc — the srcdoc builder that keeps the Preview egress-free
// (the frame inherits the app CSP) while relative URLs still resolve.

import { describe, expect, test } from "bun:test";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, fitScale, htmlPreviewDoc, kindOf, zoomStep } from "./FileSurface";

describe("kindOf", () => {
  test("html family → the two-mode html kind", () => {
    expect(kindOf("page.html")).toBe("html");
    expect(kindOf("Page.HTML")).toBe("html");
    expect(kindOf("index.htm")).toBe("html");
    expect(kindOf("doc.xhtml")).toBe("html");
  });

  test("xml stays text (only real html gets the preview)", () => {
    expect(kindOf("feed.xml")).toBe("text");
  });

  test("neighbors are unchanged", () => {
    expect(kindOf("notes.txt")).toBe("text");
    expect(kindOf("clip.mp3")).toBe("audio");
    expect(kindOf("clip.mov")).toBe("video");
    expect(kindOf("pic.png")).toBe("image");
    expect(kindOf("vector.svg")).toBe("image");
    expect(kindOf("doc.pdf")).toBe("pdf");
    expect(kindOf("book.xlsx")).toBe("sheet");
    expect(kindOf("data.csv")).toBe("sheet");
    expect(kindOf("talk.audio.txt")).toBe("text");
    expect(kindOf("mystery.blob")).toBe("other");
  });
});

describe("htmlPreviewDoc — <base> injection for the sandboxed srcdoc Preview", () => {
  const URL = "asset://localhost/%2FUsers%2Fx%2Fpage.html";
  const BASE = `<base href="${URL}">`;

  test("goes right after <head> when one exists", () => {
    expect(htmlPreviewDoc("<html><head><title>t</title></head><body>b</body></html>", URL)).toBe(
      `<html><head>${BASE}<title>t</title></head><body>b</body></html>`,
    );
    // attributes + case survive
    expect(htmlPreviewDoc('<HEAD lang="en">x</HEAD>', URL)).toBe(`<HEAD lang="en">${BASE}x</HEAD>`);
  });

  test("falls back to after <html>, then after the doctype — NEVER before it", () => {
    expect(htmlPreviewDoc("<html><body>b</body></html>", URL)).toBe(
      `<html>${BASE}<body>b</body></html>`,
    );
    const doc = htmlPreviewDoc("<!DOCTYPE html>\n<p>hi</p>", URL);
    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true); // quirks mode never triggered
    expect(doc).toBe(`<!DOCTYPE html>${BASE}\n<p>hi</p>`);
  });

  test("a bare fragment just gets the base prepended", () => {
    expect(htmlPreviewDoc("<p>hi</p>", URL)).toBe(`${BASE}<p>hi</p>`);
    expect(htmlPreviewDoc("", URL)).toBe(BASE);
  });

  test("a quote in the URL can't break out of the href attribute", () => {
    expect(htmlPreviewDoc("x", 'a"><script>1</script>')).toBe(
      '<base href="a%22><script>1</script>">x',
    );
  });
});

describe("image zoom math", () => {
  test("fit contains a large image in the body", () => {
    // 4000×3000 @1x in an 800×600 body → 0.2 on both axes
    expect(fitScale(4000, 3000, 800, 600, 1)).toBe(0.2);
    // the tighter axis wins: wide image in a tall body
    expect(fitScale(2000, 500, 1000, 1000, 1)).toBe(0.5);
  });

  test("fit NEVER upscales — a small image stays at 100%", () => {
    expect(fitScale(32, 32, 800, 600, 1)).toBe(1);
  });

  test("retina: 100% means points — dpr halves a 2x screenshot's px", () => {
    // a 1600×1200 @2x screenshot is 800×600 points; it fits a 800×600 body exactly
    expect(fitScale(1600, 1200, 800, 600, 2)).toBe(1);
    // and needs half-scale in a 400×300 body
    expect(fitScale(1600, 1200, 400, 300, 2)).toBe(0.5);
  });

  test("degenerate inputs fall back to 1 (never NaN/Infinity)", () => {
    expect(fitScale(0, 0, 800, 600, 1)).toBe(1);
    expect(fitScale(100, 100, 0, 0, 1)).toBe(1);
    expect(fitScale(100, 100, 800, 600, 0)).toBe(1); // dpr 0 guards to 1
  });

  test("zoomStep is multiplicative and clamps at the band edges", () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1.25, -1)).toBe(1);
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  test("clampZoom: garbage in → 1, band respected", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(0.0001)).toBe(ZOOM_MIN);
    expect(clampZoom(2)).toBe(2);
  });
});
