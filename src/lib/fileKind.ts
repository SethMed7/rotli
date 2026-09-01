// Shared file-name / extension helpers + the raster-image extension set
// (the maintainer, 2026-06-30). glyphs.tsx (the row/tab type mark) and FileSurface.tsx
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

/** Video containers WKWebView plays natively over the asset protocol (which
 * serves range requests, so seeking works). One definition: the file viewer,
 * the Markdown embed, and the drop router share it. */
export const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "m4v", "ogv"]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

/** The MIME type for an image extension, for building a data URL from bytes
 * read over IPC; a generic binary type for anything Rotli does not know. */
export function imageMimeOf(ext: string): string {
  return IMAGE_MIME[ext] ?? "application/octet-stream";
}
