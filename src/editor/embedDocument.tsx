import DocumentEditor from "../components/documentEditor";
import { isEditableDocxExt } from "../documents/kinds";
import { extOf, fileName } from "../lib/fileKind";

export function DocumentEmbed({ fileId }: { fileId: string }) {
  const ext = extOf(fileName(fileId));
  if (isEditableDocxExt(ext)) return <DocumentEditor fileId={fileId} compact />;
  return (
    <div className="rotli-document-placeholder">
      <span>
        Convert this {`.${ext || "document"}`} file to DOCX to edit it here.
      </span>
    </div>
  );
}
