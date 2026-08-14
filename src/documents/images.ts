import type { DocumentImage } from "./model";
import { GENERATED_DOCX_THEME } from "./theme";

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function dimensions(
  data: Uint8Array,
  mimeType: DocumentImage["mimeType"],
): { width: number; height: number } {
  if (mimeType === "image/png" && data.length >= 24) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/gif" && data.length >= 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (mimeType === "image/bmp" && data.length >= 26) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }
  if (mimeType === "image/jpeg") {
    for (let offset = 2; offset + 8 < data.length;) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1] ?? 0;
      const length = ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
        return {
          height: ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0),
          width: ((data[offset + 7] ?? 0) << 8) | (data[offset + 8] ?? 0),
        };
      }
      offset += length + 2;
    }
  }
  return { width: 16, height: 9 };
}

/** Size an embedded visual within the writable page while retaining its native
 * aspect ratio. Bytes remain untouched; only the drawing frame is fitted. */
export function documentImageFromBase64(
  id: string,
  name: string,
  mimeType: DocumentImage["mimeType"],
  base64: string,
): DocumentImage {
  const natural = dimensions(bytes(base64), mimeType);
  const safeWidth = natural.width > 0 ? natural.width : 16;
  const safeHeight = natural.height > 0 ? natural.height : 9;
  const scale = Math.min(
    GENERATED_DOCX_THEME.imageMaxWidthPx / safeWidth,
    GENERATED_DOCX_THEME.imageMaxHeightPx / safeHeight,
    1,
  );
  return {
    id,
    name,
    mimeType,
    base64,
    widthPx: Math.max(1, Math.round(safeWidth * scale)),
    heightPx: Math.max(1, Math.round(safeHeight * scale)),
    alt: name,
  };
}
