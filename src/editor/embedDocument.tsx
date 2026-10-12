import DocumentEditor from "../components/documentEditor";
import { WEB_DOCX_COPY_HINT } from "../components/fileOffice/officeMount";
import { isEditableDocxExt } from "../documents/kinds";
import { PLATFORM } from "../lib/featurePolicy";
import { extOf, fileName } from "../lib/fileKind";

export function DocumentEmbed({ fileId }: { fileId: string }) {
  const ext = extOf(fileName(fileId));
  if (isEditableDocxExt(ext)) return <DocumentEditor fileId={fileId} compact />;
  return (
    <div className="rotli-document-placeholder">
      <span>
        {PLATFORM === "desktop"
          ? `Convert this .${ext || "document"} file to DOCX to edit it here.`
          : WEB_DOCX_COPY_HINT}
      </span>
    </div>
  );
}
