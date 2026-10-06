import { DOCX_EDITABLE } from "../documents/kinds";
import { isBetaFileExt } from "../newItems/model";
import { sheetReadOnlyReason } from "../sheets/kinds";
import { BetaBadge } from "./betaBadge";

/** The status marks beside an open file's name: Beta while a Univer editor is
 * mounted, otherwise the reason editing is off. Never both — a read-only view
 * keeps its own label and no Beta mark (DESIGN.md, Required states). */
export function FileHeaderMarks({
  kind,
  ext,
  stat,
  probed,
  tooLarge,
  sheetEditable,
  documentEditable,
}: {
  kind: string;
  ext: string;
  stat: { writable: boolean } | null;
  probed: boolean;
  tooLarge: boolean;
  sheetEditable: boolean;
  documentEditable: boolean;
}) {
  if ((sheetEditable || documentEditable) && isBetaFileExt(ext)) return <BetaBadge />;
  // EVERY read-only sheet says WHY editing is off, not just the read-only
  // root — .ods/.xls/oversize/failed-probe were silent (#53, audit 2026-07)
  if (kind === "sheet" && probed && !sheetEditable && !tooLarge) {
    const reason = sheetReadOnlyReason(stat, ext);
    return (
      <span className="file-readonly" title={reason.title}>
        {reason.label}
      </span>
    );
  }
  if (kind === "document" && probed && DOCX_EDITABLE.has(ext) && !documentEditable && !tooLarge) {
    return (
      <span className="file-readonly" title="Move this document into Assets to edit it locally.">
        read-only location
      </span>
    );
  }
  return null;
}
