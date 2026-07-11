import { useEffect, useState } from "react";
import { previewManagedDocument } from "../documents/composition";
import { fileName } from "../lib/fileKind";

export function DocumentPreview({ fileId, compact = false }: { fileId: string; compact?: boolean }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; srcDoc: string; warnings: string[] }
    | { kind: "too-large" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void previewManagedDocument(fileId)
      .then((preview) => {
        if (!cancelled) setState(preview);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Couldn’t preview this document",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (state.kind === "loading") {
    return <div className="rotli-document-placeholder">Preparing document…</div>;
  }
  if (state.kind === "too-large") {
    return <div className="rotli-document-placeholder">Document is too large to preview safely</div>;
  }
  if (state.kind === "error") {
    return <div className="rotli-document-placeholder">{state.message}</div>;
  }
  return (
    <div className={compact ? "rotli-document-preview compact" : "rotli-document-preview"}>
      <iframe title={`Preview of ${fileName(fileId)}`} sandbox="" srcDoc={state.srcDoc} />
      {!compact && state.warnings.length > 0 && (
        <div className="rotli-document-warning" title={state.warnings.join("\n")}>
          Preview simplified {state.warnings.length} unsupported detail
          {state.warnings.length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
