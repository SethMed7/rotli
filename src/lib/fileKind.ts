// Shared file-name / extension helpers + the raster-image extension set
// (Seth, 2026-06-30). glyphs.tsx (the row/tab type mark) and FileSurface.tsx
// (the in-app viewer) both need "what's this file's basename + extension" and
// "is it a raster image"; this is the one definition they share.

/** Raster image extensions that read as a picture (the IDE image glyph). NOTE:
 * `svg` is intentionally excluded — it has its own brand mark in glyphs; the
 * file viewer adds svg/ico locally since it can render them in an <img>. */
export const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "avif",
  "bmp",
  "tiff",
  "tif",
]);

/** The basename of a corpus wire id / path ("a/b/c.png" → "c.png"). */
export function fileName(id: string): string {
  return id.split("/").pop() ?? id;
}

/** The lowercased extension of a filename ("Photo.PNG" → "png"); "" when none. */
export function extOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}
