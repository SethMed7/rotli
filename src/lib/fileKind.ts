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

/** A filename's name without its extension ("a/Plan v2.docx" → "Plan v2"). */
export function fileNameStem(id: string): string {
  const name = fileName(id);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The filename a person's typed name becomes: a typed matching extension is
 * dropped, separators flatten to `-`, and `ext` is always re-appended. The
 * Rust twin (corpus_file_rename.rs `renamed_file_name`) is the enforcing copy. */
export function userFileName(requested: string, ext: string): string {
  const trimmed = requested.trim();
  const dotted = `.${ext}`;
  const bare = trimmed.toLowerCase().endsWith(dotted) ? trimmed.slice(0, -dotted.length) : trimmed;
  const stem = bare.replace(/[/\\:]/g, "-").trim();
  if (!stem) throw new Error("a document needs a name");
  if (stem.startsWith(".")) throw new Error(`“${stem}” can’t be used as a file name`);
  return `${stem}.${ext}`;
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

/** The file-details fact for a Rotli-managed file: documents, sheets, and
 * assets live in the vault's storage/ folder, which the vault's .gitignore
 * excludes by contract. Null for any file outside storage/. */
export function managedFileNote(id: string): string | null {
  return /^storage\//i.test(id) ? "Stored in storage/ inside your vault — not tracked by git." : null;
}
