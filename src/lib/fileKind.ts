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

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const startsWith = (bytes: Uint8Array, head: number[]) => head.every((b, i) => bytes[i] === b);
const at = (bytes: Uint8Array, from: number, text: string) => startsWith(bytes.subarray(from), ascii(text));

/** Whether `bytes` really are a `.ext` image: the same magic numbers Rust
 * checks in corpus.rs `image_payload_matches_extension`, so a `.png` that is
 * not a PNG is refused on the web exactly as the Mac app refuses it. */
export function imageBytesMatchExtension(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return at(bytes, 0, "GIF87a") || at(bytes, 0, "GIF89a");
    case "webp":
      return at(bytes, 0, "RIFF") && at(bytes, 8, "WEBP");
    case "bmp":
      return at(bytes, 0, "BM");
    case "tif":
    case "tiff":
      return startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]);
    case "heic":
    case "heif":
    case "avif": {
      if (!at(bytes, 4, "ftyp")) return false;
      const brands =
        ext === "avif" ? ["avif", "avis"] : ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
      for (let i = 8; i + 4 <= Math.min(bytes.length, 64); i += 4) {
        if (brands.some((brand) => at(bytes, i, brand))) return true;
      }
      return false;
    }
    default:
      return false;
  }
}
