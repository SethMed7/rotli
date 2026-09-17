import { describe, expect, test } from "bun:test";

import { imageBytesMatchExtension, managedFileNote } from "./fileKind";

describe("managed file details", () => {
  test("only storage/ files carry the not-tracked-by-git fact", () => {
    expect(managedFileNote("storage/rotli/plan.docx")).toContain("not tracked by git");
    expect(managedFileNote("wiki/projects/reference.pdf")).toBeNull();
  });
});

describe("imageBytesMatchExtension (twin of corpus.rs image_payload_matches_extension)", () => {
  const b = (...xs: (number | string)[]) =>
    new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  test("each raster magic number, and a mismatch", () => {
    expect(imageBytesMatchExtension("png", b(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(imageBytesMatchExtension("jpg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(imageBytesMatchExtension("gif", b("GIF89a"))).toBe(true);
    expect(imageBytesMatchExtension("webp", b("RIFF", 0, 0, 0, 0, "WEBP"))).toBe(true);
    expect(imageBytesMatchExtension("bmp", b("BM"))).toBe(true);
    expect(imageBytesMatchExtension("tiff", b("II*", 0))).toBe(true);
    expect(imageBytesMatchExtension("heic", b(0, 0, 0, 24, "ftyp", "heic"))).toBe(true);
    expect(imageBytesMatchExtension("avif", b(0, 0, 0, 24, "ftyp", "mif1", "avif"))).toBe(true);
    expect(imageBytesMatchExtension("avif", b(0, 0, 0, 24, "ftyp", "heic"))).toBe(false);
    expect(imageBytesMatchExtension("png", b("GIF89a"))).toBe(false);
    expect(imageBytesMatchExtension("svg", b("<svg"))).toBe(false);
    expect(imageBytesMatchExtension("png", new Uint8Array())).toBe(false);
  });
});
