import { DOCX_EDITABLE, DOCUMENT_EDIT_MAX_BYTES } from "../../documents/kinds";
import { LAUNCH_FEATURES } from "../../lib/featurePolicy";
import { SHEET_BIN, SHEET_EDIT_MAX_BYTES, sheetFormatEditable, workbookWithheld } from "../../sheets/kinds";
import type { SheetTable } from "../../sheets/view";

export const OFFICE_READ_MAX_BYTES = 8_000_000;
type Features = Pick<typeof LAUNCH_FEATURES, "documents" | "sheets">;
type OfficeKind = "document" | "sheet";
type OfficeStat = { len: number; writable: boolean };

export function officeEditability(
  kind: OfficeKind,
  ext: string,
  stat: OfficeStat | null,
  features: Features = LAUNCH_FEATURES,
): boolean {
  if (!stat?.writable) return false;
  if (kind === "document")
    return features.documents && DOCX_EDITABLE.has(ext) && stat.len <= DOCUMENT_EDIT_MAX_BYTES;
  return sheetFormatEditable(ext, features) && stat.len <= SHEET_EDIT_MAX_BYTES;
}

export interface OfficeProbePorts<Stat extends OfficeStat> {
  stat(): Promise<Stat | null>;
  bytes(): Promise<string>;
  text(): Promise<string>;
  parse(input: { base64?: string; csv?: string; delimiter?: string }): Promise<SheetTable[]>;
}

/** Decide the mounted editor, bounded table view, or explicit unsupported state. */
export async function probeOffice<Stat extends OfficeStat>(
  kind: OfficeKind,
  ext: string,
  ports: OfficeProbePorts<Stat>,
  features: Features = LAUNCH_FEATURES,
): Promise<{
  probed: true;
  stat: Stat | null;
  editable: boolean;
  tooLarge: boolean;
  withheld: boolean;
  tables: SheetTable[] | null;
}> {
  const empty = {
    probed: true as const,
    stat: null,
    editable: false,
    tooLarge: false,
    withheld: false,
    tables: null,
  };
  if (kind === "document" && (!features.documents || !DOCX_EDITABLE.has(ext))) return empty;
  if (kind === "sheet" && workbookWithheld(ext, features)) return { ...empty, withheld: true };
  const stat = await ports.stat().catch(() => null);
  const editable = officeEditability(kind, ext, stat, features);
  if (kind === "document")
    return { ...empty, stat, editable, tooLarge: !!stat && stat.len > DOCUMENT_EDIT_MAX_BYTES };
  if (editable) return { ...empty, stat, editable };
  if (stat && stat.len > OFFICE_READ_MAX_BYTES) return { ...empty, stat, tooLarge: true };
  const tables = SHEET_BIN.has(ext)
    ? await ports.parse({ base64: await ports.bytes() })
    : await ports.parse({ csv: await ports.text(), delimiter: ext === "tsv" ? "\t" : "," });
  return { ...empty, stat, tables };
}
