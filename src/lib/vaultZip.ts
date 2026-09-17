// Zip a vault export (text files plus the images dropped in the browser) — the
// one place Rotli Web touches JSZip, kept behind this adapter like the document
// codecs.

import JSZip from "jszip";

/** A zip of `files` (path → text) and `binaries` (path → bytes: dropped
 * images), folders implied by the paths. */
export async function zipTextFiles(
  files: Readonly<Record<string, string>>,
  binaries: Readonly<Record<string, Uint8Array>> = {},
): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  for (const [path, bytes] of Object.entries(binaries)) zip.file(path, bytes);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Read a zip back into path → text (tests, and a future import-from-zip). */
export async function unzipTextFiles(blob: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out[path] = await entry.async("string");
  }
  return out;
}
