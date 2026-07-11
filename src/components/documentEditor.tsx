// Thin React shell for editable DOCX files. React owns lifecycle, save status,
// and keyboard scope; Univer and OOXML remain behind documents/ adapters.

import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editManagedDocument } from "../documents/composition";
import {
  deleteParkedDocument,
  getParkedDocument,
  registerLiveDocument,
  setParkedDocument,
  unregisterLiveDocument,
  type ReadyDocumentSession,
} from "../documents/session";
import type { EditableDocument } from "../documents/model";
import type { DocumentEngineHandle } from "../documents/engine/univer";
import { corpusFileStat } from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";

function currentAppTheme(): string {
  return document.documentElement.dataset.theme ?? "charcoal";
}

export default function DocumentEditor({
  fileId,
  paneId,
  compact = false,
  chromeSlotRef,
}: {
  fileId: string;
  paneId?: string;
  compact?: boolean;
  chromeSlotRef?: RefObject<HTMLElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ReadyDocumentSession | null>(null);
  const handleRef = useRef<DocumentEngineHandle | null>(null);
  const diskLenRef = useRef(0);
  const dirtyGenRef = useRef(0);
  const armedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chromeEl, setChromeEl] = useState<HTMLElement | null>(null);
  const [appTheme, setAppTheme] = useState(currentAppTheme);

  useEffect(() => {
    setChromeEl(chromeSlotRef?.current ?? null);
  }, [chromeSlotRef]);

  useEffect(() => {
    const sync = () => setAppTheme(currentAppTheme());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let disposeEngine: (() => void) | null = null;
    armedRef.current = false;
    setReady(false);
    setErr(null);

    void (async () => {
      try {
        const stat = await corpusFileStat(fileId);
        if (!stat?.writable) throw new Error("This document is in a read-only location.");
        diskLenRef.current = stat.len;

        let park = getParkedDocument(fileId);
        if (park && park.diskLen !== stat.len) {
          deleteParkedDocument(fileId);
          park = undefined;
        }

        let session: ReadyDocumentSession;
        let model: EditableDocument;
        if (park) {
          session = park.session;
          model = park.document;
          dirtyGenRef.current = Math.max(1, park.dirtyGen);
          setDirty(true);
          setWarnings(session.warnings);
        } else {
          const outcome = await editManagedDocument(fileId);
          if (outcome.kind === "too-large") {
            throw new Error("This document is too large to edit safely in Rotli.");
          }
          session = outcome;
          model = outcome.document;
          dirtyGenRef.current = 0;
          setDirty(false);
          setWarnings(outcome.warnings);
        }
        if (disposed) return;
        sessionRef.current = session;

        const { mountDocumentEditor } = await import("../documents/engine/univer");
        if (disposed) return;
        const handle = mountDocumentEditor(host, model);
        handleRef.current = handle;
        const subscription = handle.onDirty(() => {
          if (!armedRef.current) return;
          dirtyGenRef.current += 1;
          setDirty(true);
        });
        armedRef.current = true;
        disposeEngine = () => {
          if (subscription && typeof subscription === "object") subscription.dispose?.();
          handle.dispose();
        };
        setReady(true);
      } catch (error) {
        if (!disposed) setErr(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      disposed = true;
      unregisterLiveDocument(fileId);
      try {
        const session = sessionRef.current;
        const handle = handleRef.current;
        if (session && handle && dirtyGenRef.current > 0) {
          setParkedDocument(fileId, {
            session,
            document: handle.save(),
            diskLen: diskLenRef.current,
            dirtyGen: dirtyGenRef.current,
          });
        }
      } catch {
        /* an editor teardown must never block tab or theme changes */
      }
      disposeEngine?.();
      handleRef.current = null;
      sessionRef.current = null;
    };
  }, [fileId, appTheme]);

  useEffect(() => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    if (!dirty || !session || !handle) {
      unregisterLiveDocument(fileId);
      return;
    }
    registerLiveDocument({
      fileId,
      session,
      snapshot: () => handle.save(),
      diskLen: diskLenRef.current,
      dirtyGen: () => dirtyGenRef.current,
      onFlushed: (generation) => {
        if (dirtyGenRef.current === generation) {
          dirtyGenRef.current = 0;
          setDirty(false);
          deleteParkedDocument(fileId);
          unregisterLiveDocument(fileId);
        }
      },
    });
    return () => unregisterLiveDocument(fileId);
  }, [dirty, fileId, ready]);

  const save = async () => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    if (!session || !handle || saving || dirtyGenRef.current === 0) return;
    const generation = dirtyGenRef.current;
    setSaving(true);
    setErr(null);
    try {
      await session.save(handle.save());
      const stat = await corpusFileStat(fileId).catch(() => null);
      if (stat) diskLenRef.current = stat.len;
      if (dirtyGenRef.current === generation) {
        dirtyGenRef.current = 0;
        setDirty(false);
        deleteParkedDocument(fileId);
        unregisterLiveDocument(fileId);
      }
      void invalidateNotes();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "s") return;
      const inThisEmbed = compact && !!hostRef.current?.contains(document.activeElement);
      const inThisPane = !!paneId && usePanesStore.getState().focusedPaneId === paneId;
      if (!inThisEmbed && !inThisPane) return;
      event.preventDefault();
      event.stopPropagation();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [compact, paneId]);

  const chrome = (
    <div className="document-chrome-actions">
      {warnings.length > 0 && (
        <span className="document-preserved" title={warnings.join("\n")}>
          Complex content preserved
        </span>
      )}
      {err && <span className="document-save-error">⚠ {err}</span>}
      {dirty && !saving && <span className="document-dirty" title="Unsaved changes" />}
      <button
        type="button"
        className="document-save"
        disabled={!ready || saving || !dirty}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : dirty ? "Save ⌘S" : "Saved"}
      </button>
    </div>
  );

  return (
    <div className={compact ? "document-editor compact" : "document-editor"}>
      {chromeEl ? createPortal(chrome, chromeEl) : <div className="document-editor-bar">{chrome}</div>}
      {!err && !ready && <p className="file-loading">Opening editor…</p>}
      {err && !ready && <p className="file-err">⚠ {err}</p>}
      <div ref={hostRef} className="document-editor-host" />
    </div>
  );
}
