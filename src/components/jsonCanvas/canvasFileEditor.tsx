// A `.canvas` file opened in a pane (development builds, spike 2026-10-05):
// loads through jsonCanvas/composition and hands the document to the editor.

import "../../styles/jsonCanvas.css";
import { useMemo } from "react";

import { useCanvasFile, useCanvasNotes } from "../../jsonCanvas/composition";
import { usePanesStore } from "../../state/panes";
import { CanvasEditor } from "./canvasEditor";

export function CanvasFileEditor({ fileId }: { fileId: string }) {
  const { state, change } = useCanvasFile(fileId);
  const paths = useMemo(
    () =>
      state.status === "ready"
        ? state.doc.nodes.flatMap((node) => (node.type === "file" ? [node.file] : []))
        : [],
    [state],
  );
  const { noteFor, resolveLink, noteIdAt } = useCanvasNotes(paths);

  if (state.status === "loading") return <p className="file-loading">Opening canvas…</p>;
  if (state.status === "error") return <p className="file-err jc-error">⚠ {state.error}</p>;
  return (
    <div className="jc-host">
      {!state.writable && (
        <p className="jc-banner">This canvas is in a read-only place. Changes won’t be saved.</p>
      )}
      {state.saveError && (
        <p className="jc-banner" role="alert">
          Couldn’t save — {state.saveError}
        </p>
      )}
      <CanvasEditor
        doc={state.doc}
        onChange={change}
        noteFor={noteFor}
        resolveLink={resolveLink}
        onOpenNote={(path) => {
          const id = noteIdAt(path);
          if (id) usePanesStore.getState().openNote(id, { newTab: true });
        }}
      />
    </div>
  );
}
