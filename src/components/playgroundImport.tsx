import { useState } from "react";

import { importPlayground } from "../services/hooks";
import { useViewsStore } from "../state/views";
import type { PlaygroundImportResult } from "../types";

export function PlaygroundImport({ disabled = false }: { disabled?: boolean }) {
  const viewsWritable = useViewsStore((state) => state.writable);
  const viewsDirty = useViewsStore((state) => state.dirty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const unavailable = disabled || !viewsWritable || viewsDirty;

  const run = async () => {
    setBusy(true);
    setError(false);
    setMessage(null);
    try {
      const result = await importPlayground();
      setMessage(playgroundImportMessage(result));
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4 className="sethead">Playground</h4>
      <p className="lead">
        Add four editable Markdown lessons in a named Playground view. Delete the view whenever you&rsquo;re
        done; your notes stay in the vault.
      </p>
      <button type="button" className="ghostbtn" disabled={busy || unavailable} onClick={() => void run()}>
        {busy ? "Importing…" : "Import playground"}
      </button>
      {unavailable && (
        <p className="setnote">Finish any pending view save and make this vault writable before importing.</p>
      )}
      {message && (
        <p className={error ? "setnote err" : "setnote"} role={error ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
      )}
    </>
  );
}

export function playgroundImportMessage(result: PlaygroundImportResult): string {
  return result.imported
    ? `Imported ${result.noteCount} lessons into the ${result.viewName} view.`
    : `The ${result.viewName} view is already available.`;
}
