import { DocumentPreview } from "../components/documentPreview";
import { isDocxPreviewExt } from "../documents/kinds";
import { extOf, fileName } from "../lib/fileKind";

export function DocumentEmbed({ fileId }: { fileId: string }) {
  const ext = extOf(fileName(fileId));
  if (isDocxPreviewExt(ext)) return <DocumentPreview fileId={fileId} compact />;
  return (
    <div className="rotli-document-placeholder">
      <span>
        {`.${ext || "document"}`} is managed by Rotli, but needs its native app to preview. Use Open
        to view or edit it.
      </span>
    </div>
  );
}
