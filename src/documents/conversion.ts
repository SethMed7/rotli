import { extOf, fileName } from "../lib/fileKind";
import { DOCUMENT_CONVERTIBLE } from "./kinds";

export interface LocalDocumentConverter {
  convertToManagedDocx(id: string): Promise<string>;
}

/** Application workflow for legacy local documents. The host performs the
 * conversion; this layer owns the honest format gate and never overwrites the
 * source file. */
export async function convertLegacyDocument(converter: LocalDocumentConverter, id: string): Promise<string> {
  const ext = extOf(fileName(id));
  if (!DOCUMENT_CONVERTIBLE.has(ext)) {
    throw new Error(`.${ext || "unknown"} does not have a faithful local DOCX conversion path`);
  }
  const convertedId = await converter.convertToManagedDocx(id);
  if (!convertedId) throw new Error("The local converter did not create a DOCX file");
  return convertedId;
}
