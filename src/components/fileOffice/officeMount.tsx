import { Suspense, lazy, type RefObject } from "react";

import { DOCX_EDITABLE, DOCUMENT_CONVERTIBLE } from "../../documents/kinds";
import { LAUNCH_FEATURES, PLATFORM } from "../../lib/featurePolicy";

/** How to edit a PDF or legacy document on Rotli Web, where conversion (a
 * Mac-only local converter) isn't offered: make the DOCX elsewhere. */
export const WEB_DOCX_COPY_HINT =
  "Rotli edits Word documents saved as .docx. Open this file in Word, Pages, or LibreOffice, save a .docx copy into this vault, then open the copy here.";

// Keep the editor engines out of the initial file-surface bundle.
const SheetEditor = lazy(() => import("../../sheets/sheetEditor"));
const DocumentEditor = lazy(() => import("../documentEditor"));

export function OfficeMount({
  kind,
  ext,
  fileId,
  paneId,
  probed,
  editable,
  tooLarge,
  withheld,
  error,
  chromeSlotRef,
  converting,
  conversionError,
  convertDocument,
}: {
  kind: "document" | "sheet";
  ext: string;
  fileId: string;
  paneId: string;
  probed: boolean;
  editable: boolean;
  tooLarge: boolean;
  withheld: boolean;
  error: string | null;
  chromeSlotRef: RefObject<HTMLDivElement | null>;
  converting: boolean;
  conversionError: string;
  convertDocument: () => void;
}) {
  if (error) return null;
  if (tooLarge)
    return (
      <p className="file-loading">
        {kind === "document"
          ? PLATFORM === "desktop"
            ? "This document is too large to edit safely in Rotli — open it externally instead."
            : "This document is too large to edit safely in Rotli. Open the original in another app."
          : PLATFORM === "desktop"
            ? "this file is too large to view in rotli — Open externally shows the whole thing"
            : "This file is too large to view in Rotli. Open the original in another app."}
      </p>
    );
  if (kind === "sheet") {
    if (withheld)
      return (
        <div className="file-document-fallback">
          <h2>.{ext} is unsupported in this build</h2>
          <p>
            Spreadsheets aren’t available in this build yet. Open the original externally, or save a CSV copy
            to edit it in Rotli.
          </p>
        </div>
      );
    return probed && editable ? (
      <Suspense fallback={<p className="file-loading">Loading…</p>}>
        <SheetEditor
          key={fileId}
          fileId={fileId}
          paneId={paneId}
          mode={ext === "csv" ? "csv" : "xlsx"}
          chromeSlotRef={chromeSlotRef}
        />
      </Suspense>
    ) : null;
  }
  if (!probed) return null;
  if (editable)
    return (
      <Suspense fallback={<p className="file-loading">Opening editor…</p>}>
        <DocumentEditor key={fileId} fileId={fileId} paneId={paneId} chromeSlotRef={chromeSlotRef} />
      </Suspense>
    );
  if (!LAUNCH_FEATURES.documents)
    return (
      <div className="file-document-fallback">
        <h2>.{ext || "unknown"} is unsupported in this build</h2>
        <p>Documents aren’t available in this build yet.</p>
      </div>
    );
  if (DOCX_EDITABLE.has(ext))
    return (
      <div className="file-document-fallback">
        <p>This document is in a protected location. Move it into Assets to edit it.</p>
      </div>
    );
  if (PLATFORM !== "desktop")
    return (
      <div className="file-document-fallback">
        <h2>.{ext || "unknown"} can’t be edited on the web</h2>
        <p>{WEB_DOCX_COPY_HINT}</p>
      </div>
    );
  return (
    <div className="file-document-fallback">
      {DOCUMENT_CONVERTIBLE.has(ext) ? (
        <>
          <h2>Convert a copy to edit here</h2>
          <p>
            Rotli can use the local macOS document converter for .{ext}. It creates a new managed DOCX in
            Assets and leaves the original unchanged.
          </p>
          <button
            type="button"
            className="file-convert-document"
            disabled={converting}
            onClick={convertDocument}
          >
            {converting ? "Converting…" : "Convert copy to DOCX"}
          </button>
          {conversionError && (
            <p className="file-conversion-error" role="alert">
              {conversionError}
            </p>
          )}
          <p className="file-conversion-note">
            Complex layout, embedded objects, and legacy fields may need review after conversion.
          </p>
        </>
      ) : (
        <>
          <h2>.{ext || "unknown"} is unsupported</h2>
          <p>
            Rotli does not have a faithful local conversion path for this format. Open the original externally
            and export a DOCX copy to edit it in Rotli.
          </p>
        </>
      )}
    </div>
  );
}
